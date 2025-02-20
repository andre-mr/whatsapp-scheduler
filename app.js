import { makeWASocket, useMultiFileAuthState, DisconnectReason } from "@whiskeysockets/baileys";
import pino from "pino";
import { ConsoleColors } from "./modules/constants.js";
import { getWhatsAppVersion, consoleLogColor } from "./modules/utils.js";
import { manageProcessPID, saveConfig, saveData, loadConfig, loadData, clearOldFiles } from "./modules/fileManager.js";
import { interpretMessage } from "./modules/messageInterpreter.js";
import { processOpenAIQuery } from "./modules/openaiQuery.js";
import { evaluateMessage } from "./modules/messageEvaluator.js";
import { processResponse } from "./modules/responseProcessor.js";

manageProcessPID();

// In-memory data for global configs
const configStore = {
  admin: [], // Authorized numbers
  listen: true, // Responds to requests
  freemode: true, // Responds without needing mentions
  notify: true, // Notifications on
  ownnumber: "", // Bot's own number
  timezone: "America/Sao_Paulo", // BR timezone to display dates
  waversion: [2, 3000, 1019066527], // WhatsApp web version
};

const defaultUserData = {
  configs: { expiration: 0, listen: true, notify: true, timezone: "America/Sao_Paulo" },
  events: [],
  tasks: [],
};

const defaultGroupData = {
  configs: { expiration: 0, listen: true, notify: true, freemode: true, timezone: "America/Sao_Paulo" },
  events: [],
  tasks: [],
};

const dataStore = {};

let state, saveCreds, currentVersion, sock;

loadConfig(configStore);
loadData(dataStore);

// Function to send messages checking expiration configuration
async function handleSendMessage(jid, message) {
  await new Promise((resolve) => setTimeout(resolve, Math.random() * 1000));

  if (dataStore[jid].configs.expiration > 0) {
    await sock.sendMessage(jid, { disappearingMessagesInChat: dataStore[jid].configs.expiration });
    await sock.sendMessage(jid, { text: message }, { ephemeralExpiration: dataStore[jid].configs.expiration });
  } else {
    await sock.sendMessage(jid, { text: message });
  }
}

// Function to check events and trigger messages
function scheduleEvents() {
  setInterval(async () => {
    const now = new Date();

    // Purge past events regardless of active notifications
    Object.values(dataStore).forEach((storeItem) => {
      if (storeItem.events) {
        storeItem.events = storeItem.events.filter((event) => {
          const eventTime = new Date(event.datetime);
          const notifyTime = new Date(eventTime.getTime() - (event.notify || 0) * 60 * 1000);
          const delayLimit = new Date(notifyTime.getTime() + 60 * 60 * 1000);

          return now <= delayLimit; // Keep events within tolerance window
        });
      }
    });

    if (!configStore.notify) {
      saveData(dataStore);
      return; // No notifications, exit
    }

    // Filter events that should be notified and send messages
    Object.entries(dataStore).forEach(async ([senderJid, storeItem]) => {
      if (storeItem.events) {
        const dueEvents = storeItem.events.filter((event) => {
          const eventTime = new Date(event.datetime);
          const notifyTime = new Date(eventTime.getTime() - (event.notify || 0) * 60 * 1000);
          return now >= notifyTime; // Within notification time
        });

        for (const event of dueEvents) {
          try {
            // Send message to requester
            const messageText = `⏰ *${event.description}*\nEm: ${new Date(event.datetime).toLocaleString("pt-BR", {
              timeZone: storeItem.configs.timezone,
              hour: "2-digit",
              minute: "2-digit",
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            })}.`;
            handleSendMessage(senderJid, messageText);
            consoleLogColor(`Lembrete enviado para ${senderJid}: "${event.description}"`, ConsoleColors.GREEN);

            // Remove event after successful notification
            storeItem.events = storeItem.events.filter((e) => e !== event);
          } catch (error) {
            consoleLogColor(`Erro ao enviar lembrete para ${senderJid}: ${error}`, ConsoleColors.RED);
          }
        }
      }
    });

    saveData(dataStore);
  }, 60 * 1000); // Run every 1 minute
}

// Main bot function
async function runWhatsAppBot() {
  consoleLogColor("Iniciando a aplicação...", ConsoleColors.BRIGHT);

  sock = makeWASocket({
    auth: state,
    version: currentVersion,
    printQRInTerminal: true,
    logger: pino({ level: "silent" }),
  });

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "close") {
      const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
      consoleLogColor("Conexão encerrada. Reiniciando...", ConsoleColors.YELLOW);
      if (shouldReconnect) {
        runWhatsAppBot();
      }
    } else if (connection === "open") {
      consoleLogColor("Bot inicializado e pronto.", ConsoleColors.GREEN);
      scheduleEvents();
    }
  });

  sock.ev.on("creds.update", async () => {
    const userNumber = sock.user?.id?.match(/^\d+/)?.[0];

    if (userNumber) {
      if (!configStore.ownnumber) {
        consoleLogColor(`Número do bot registrado: ${userNumber}`, ConsoleColors.GREEN);
        configStore.ownnumber = userNumber;
        saveConfig(configStore);
      }
    }

    saveCreds();
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    for (const msg of messages) {
      if (msg.message?.reactionMessage) {
        continue;
      }
      const expirationTime = parseInt(
        msg.message?.ephemeralMessage?.message?.extendedTextMessage?.contextInfo?.expiration || "0"
      );
      sock.readMessages([msg.key]);

      if (
        !configStore.listen ||
        !msg.message ||
        msg.key.fromMe ||
        msg.key?.protocolMessage?.fromMe ||
        msg.message?.protocolMessage
      )
        continue;

      const isFromGroup = msg.key.remoteJid.endsWith("@g.us");
      const messageSender = isFromGroup ? msg.key.participant : msg.key.remoteJid; // Who sent the message
      const senderJid = isFromGroup ? msg.key.remoteJid : messageSender; // The group or the private number

      // Check if the sender is authorized or bot is in group
      const isAdmin = configStore.admin.includes(messageSender);
      const isAuthorized = isAdmin || dataStore[senderJid];
      if (!isAuthorized && !isFromGroup) continue;

      if (!dataStore[senderJid]) {
        dataStore[senderJid] = isFromGroup ? structuredClone(defaultGroupData) : structuredClone(defaultUserData);
        saveData(dataStore);
      }

      let messageContent =
        msg.message?.conversation ||
        msg?.message?.extendedTextMessage?.text ||
        msg?.message?.ephemeralMessage?.message?.conversation ||
        msg?.message?.ephemeralMessage?.message?.extendedTextMessage?.text ||
        "";

      // Only accept group messages if mentioned (if this requirement is enabled)
      if (
        isFromGroup &&
        (!configStore.freemode || !dataStore[senderJid]?.configs?.freemode) &&
        !messageContent.includes(`@${configStore.ownnumber}`)
      ) {
        continue;
      }

      const messageProcessed = messageContent.replace(`@${configStore.ownnumber}`, "").trim().toLowerCase();

      if (expirationTime) {
        dataStore[senderJid].configs.expiration = expirationTime;
        saveData(dataStore);
      }

      const shouldContinue = await evaluateMessage(messageProcessed, {
        isAdmin,
        dataStore,
        defaultUserData,
        senderJid,
        handleSendMessage,
        saveData,
        isAuthorized,
      });

      if (shouldContinue) {
        continue;
      }

      if (!configStore.listen || !dataStore[senderJid].configs.listen) {
        continue;
      }

      if (messageContent.includes(`@${configStore.ownnumber}`)) {
        messageContent = messageContent.replace(`@${configStore.ownnumber}`, "").trim();
      }

      consoleLogColor(`Mensagem recebida de ${senderJid}: ${messageContent}`, ConsoleColors.BRIGHT);

      const now = new Date();
      const currentDateTimeISO = now.toISOString(); // ISO 8601 UTC

      let response = interpretMessage(messageContent, currentDateTimeISO, senderJid, dataStore);

      if (response === null) {
        try {
          response = await processOpenAIQuery(messageContent, currentDateTimeISO, senderJid, dataStore);

          // If it's just a text response, send it directly
          if (response.type === "text") {
            await handleSendMessage(senderJid, response.content);
            continue;
          }
        } catch (error) {
          await handleSendMessage(senderJid, "Houve um erro ao processar sua mensagem. Tente novamente mais tarde.");
          continue;
        }
      }

      await processResponse(response, senderJid, dataStore, handleSendMessage, messageSender, saveData);
    }
  });
}

// Start bot
const startApp = async () => {
  await clearOldFiles();
  ({ state, saveCreds } = await useMultiFileAuthState("auth"));
  const newVersion = await getWhatsAppVersion(configStore.waversion);
  if (!configStore.waversion.every((v, i) => v === newVersion[i])) {
    consoleLogColor(`Versão do WhatsApp: ${newVersion.join(".")}`, ConsoleColors.CYAN);
    configStore.waversion = newVersion;
    saveConfig(configStore);
  }
  currentVersion = newVersion;
  runWhatsAppBot();
};

startApp();
