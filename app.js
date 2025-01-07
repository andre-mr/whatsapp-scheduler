import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { consoleLogColor } from "./modules/utils.js";
import { ConsoleColors } from "./modules/constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Gerenciar PID para evitar processos duplicados
function manageProcessPID() {
  const filePath = path.join(__dirname, "./modules/pid.log");

  try {
    if (fs.existsSync(filePath)) {
      const pidContent = fs.readFileSync(filePath, "utf8").trim();
      if (pidContent && !isNaN(pidContent)) {
        const oldPID = parseInt(pidContent, 10);
        try {
          process.kill(oldPID, "SIGTERM");
          consoleLogColor(`Processo anterior (PID: ${oldPID}) encerrado.`, ConsoleColors.YELLOW);
        } catch {
          consoleLogColor(`Processo anterior não encontrado (PID: ${oldPID}).`, ConsoleColors.RESET);
        }
      }
    }
    fs.writeFileSync(filePath, process.pid.toString(), "utf8");
  } catch (err) {
    consoleLogColor("Erro ao gerenciar o PID: " + err, ConsoleColors.RED);
  }
}

manageProcessPID();

import dotenv from "dotenv";
import { makeWASocket, useMultiFileAuthState, DisconnectReason } from "@whiskeysockets/baileys";
import OpenAI from "openai";
import pino from "pino";
import { fetchWhatsAppVersion } from "./modules/utils.js";
dotenv.config(); // Carregar variáveis de ambiente do arquivo .env

// Configuração da OpenAI API
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Dados em memória para configs globais
const configStore = {
  admin: [], // Números autorizados
  listen: true, // Atende solicitações
  freemode: true, // Responde sem precisar menções
  notify: true, // Notificações ativas
  ownnumber: "", // Número do próprio bot
  timezone: "America/Sao_Paulo", // fuso horário para exibir datas
  waversion: [2, 3000, 1019066527], // versão do whatsapp web
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

// Dados em memória para agendamentos
const dataStore = {};

const configFilePath = path.join(__dirname, "./modules/config.json");
const dataFilePath = path.join(__dirname, "./modules/data.json");

// Funções para manipular dados persistentes
function saveConfig() {
  fs.writeFileSync(configFilePath, JSON.stringify(configStore, null, 2));
}
function saveData() {
  fs.writeFileSync(dataFilePath, JSON.stringify(dataStore, null, 2));
}

function loadConfig() {
  if (fs.existsSync(configFilePath)) {
    try {
      const rawConfig = fs.readFileSync(configFilePath, "utf8");
      const loadedConfig = JSON.parse(rawConfig);

      // Garantir que a estrutura padrão prevaleça
      Object.keys(configStore).forEach((key) => {
        if (!(key in loadedConfig)) {
          loadedConfig[key] = configStore[key]; // Preenche valores ausentes com os padrões
        }
      });

      // Substituir o dataStore em memória com os valores corrigidos
      Object.assign(configStore, loadedConfig);

      // Persistir as correções no arquivo
      saveConfig();
    } catch (error) {
      consoleLogColor("Erro ao carregar config.json. Recriando com valores padrão.", ConsoleColors.RED);
      fs.writeFileSync(configFilePath, JSON.stringify(configStore, null, 2));
    }
  } else {
    // Criar arquivo com valores padrão caso não exista
    fs.writeFileSync(configFilePath, JSON.stringify(configStore, null, 2));
    consoleLogColor("Arquivo config.json criado com valores padrão.", ConsoleColors.YELLOW);
  }
}

function loadData() {
  if (fs.existsSync(dataFilePath)) {
    try {
      const rawData = fs.readFileSync(dataFilePath, "utf8");
      const loadedData = JSON.parse(rawData);

      // Garantir que a estrutura padrão prevaleça
      Object.keys(dataStore).forEach((key) => {
        if (!(key in loadedData)) {
          loadedData[key] = dataStore[key]; // Preenche valores ausentes com os padrões
        }
      });

      // Substituir o dataStore em memória com os valores corrigidos
      Object.assign(dataStore, loadedData);

      // Persistir as correções no arquivo
      saveData();
    } catch (error) {
      consoleLogColor("Erro ao carregar data.json. Recriando com valores padrão.", ConsoleColors.RED);
      fs.writeFileSync(dataFilePath, JSON.stringify(dataStore, null, 2));
    }
  } else {
    // Criar arquivo com valores padrão caso não exista
    fs.writeFileSync(dataFilePath, JSON.stringify(dataStore, null, 2));
    consoleLogColor("Arquivo data.json criado com valores padrão.", ConsoleColors.YELLOW);
  }
}

loadConfig();
loadData();

let state, saveCreds, currentVersion, sock;

// Função para obter a versão do WhatsApp
async function getWhatsAppVersion() {
  const latestVersion = await fetchWhatsAppVersion();
  const configVersion = configStore.waversion;

  const compareVersions = (v1, v2) => {
    for (let i = 0; i < 3; i++) {
      if (v1[i] > v2[i]) return v1;
      if (v2[i] > v1[i]) return v2;
    }
    return v1;
  };

  let currentVersion = configVersion;
  if (latestVersion) {
    currentVersion = compareVersions(configVersion, latestVersion || []);
  }

  if (!configVersion.every((v, i) => v === currentVersion[i])) {
    consoleLogColor(`Versão do WhatsApp: ${currentVersion.join(".")}`, ConsoleColors.CYAN);
    configStore.waversion = currentVersion;
    saveConfig();
  }

  return currentVersion;
}

// Limpeza de arquivos de autenticação antigos
async function clearOldFiles(directory, retentionDays) {
  const dirPath = path.resolve(directory);

  try {
    const files = await fs.promises.readdir(dirPath);

    if (files.length === 0) return;

    const filesStats = await Promise.all(
      files.map(async (file) => {
        const filePath = path.resolve(dirPath, file);
        const fileStat = await fs.promises.stat(filePath);
        return { path: filePath, mtime: fileStat.mtime };
      })
    );

    const mostRecentFile = filesStats.reduce((latest, current) => {
      return current.mtime > latest.mtime ? current : latest;
    });

    const retentionLimit = new Date(mostRecentFile.mtime);
    retentionLimit.setDate(retentionLimit.getDate() - retentionDays);

    const filesToRemove = filesStats.filter((file) => file.mtime < retentionLimit);

    for (const file of filesToRemove) {
      await fs.promises.unlink(file.path);
    }

    if (filesToRemove.length > 0) {
      consoleLogColor(`Limpeza concluída. ${filesToRemove.length} arquivos de sessão removidos.`, ConsoleColors.GREEN);
    }
  } catch (error) {
    consoleLogColor(`Erro ao limpar arquivos antigos: ${error}`, ConsoleColors.RED);
  }
}

// Função para enviar mensagens verificando a configuração de expiração
async function handleSendMessage(jid, message) {
  await new Promise((resolve) => setTimeout(resolve, Math.random() * 1000));

  if (dataStore[jid].configs.expiration > 0) {
    await sock.sendMessage(jid, { disappearingMessagesInChat: dataStore[jid].configs.expiration });
    await sock.sendMessage(jid, { text: message }, { ephemeralExpiration: dataStore[jid].configs.expiration });
  } else {
    await sock.sendMessage(jid, { text: message });
  }
}

// Função para verificar eventos e disparar mensagens
function scheduleEvents() {
  setInterval(async () => {
    const now = new Date();

    // Expurgo de eventos passados, independentemente de notificações ativas
    Object.values(dataStore).forEach((storeItem) => {
      if (storeItem.events) {
        storeItem.events = storeItem.events.filter((event) => {
          const eventTime = new Date(event.datetime);
          const notifyTime = new Date(eventTime.getTime() - (event.notify || 0) * 60 * 1000);
          const delayLimit = new Date(notifyTime.getTime() + 60 * 60 * 1000); // Permitir até 60 minutos após o horário de notificação

          return now <= delayLimit; // Manter eventos dentro da janela de tolerância
        });
      }
    });

    if (!configStore.notify) {
      saveData(); // Garantir que o expurgo seja persistido mesmo sem notificações
      return; // Sem notificações, sair da função
    }

    // Filtrar eventos que devem ser notificados e enviar mensagens
    Object.entries(dataStore).forEach(async ([senderJid, storeItem]) => {
      if (storeItem.events) {
        // Verifica se o objeto interno tem o atributo events
        const dueEvents = storeItem.events.filter((event) => {
          const eventTime = new Date(event.datetime);
          const notifyTime = new Date(eventTime.getTime() - (event.notify || 0) * 60 * 1000);
          return now >= notifyTime; // Dentro do horário de notificação
        });

        for (const event of dueEvents) {
          try {
            // Enviar mensagem ao solicitante
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

            // Remover evento após enviar notificação com sucesso
            storeItem.events = storeItem.events.filter((e) => e !== event);
          } catch (error) {
            consoleLogColor(`Erro ao enviar lembrete para ${senderJid}: ${error}`, ConsoleColors.RED);
          }
        }
      }
    });

    saveData(); // Persistir alterações no dataStore
  }, 60 * 1000); // Executar a cada 1 minuto
}

// Bot principal
async function runWhatsAppBot() {
  consoleLogColor("Iniciando a aplicação...", ConsoleColors.BRIGHT);

  sock = makeWASocket({
    auth: state,
    version: currentVersion,
    printQRInTerminal: true,
    logger: pino({ level: "silent" }),
  });

  function interpretMessage(message, currentDateTimeISO, senderJid, dataStore) {
    const lowerCaseMessage = message.toLowerCase().trim();

    // Função auxiliar para interpretar tempo em "hoje", "amanhã", "em x dias" ou data específica
    function parseDateFromMessage(message) {
      const now = new Date(currentDateTimeISO);

      // "hoje"
      if (/(hoje às|hoje) (\d{1,2}:\d{2}:\d{2}|\d{1,2}:\d{2}|\d{1,2})/.test(message)) {
        const timeMatch = message.match(/\d{1,2}(?::\d{2}(?::\d{2})?)?/); // Captura "HH", "HH:MM", ou "HH:MM:SS"
        if (timeMatch) {
          const [hours, minutes = 0, seconds = 0] = timeMatch[0].split(":").map(Number); // Define minutos/segundos padrão como 0
          now.setHours(hours, minutes, seconds, 0);
          return now.toISOString();
        }
      }

      // "amanhã"
      if (/(amanhã às|amanhã) (\d{1,2}:\d{2}:\d{2}|\d{1,2}:\d{2}|\d{1,2})/.test(message)) {
        const timeMatch = message.match(/\d{1,2}(?::\d{2}(?::\d{2})?)?/); // Captura "HH", "HH:MM", ou "HH:MM:SS"
        if (timeMatch) {
          const [hours, minutes = 0, seconds = 0] = timeMatch[0].split(":").map(Number); // Define minutos/segundos padrão como 0
          now.setDate(now.getDate() + 1);
          now.setHours(hours, minutes, seconds, 0);
          return now.toISOString();
        }
      }

      // "em x dias"
      if (/(em|daqui|daqui a) \d+ dias/.test(message)) {
        const daysMatch = message.match(/em (\d+) dias/);
        if (daysMatch) {
          const days = parseInt(daysMatch[1], 10);
          now.setDate(now.getDate() + days);
          now.setHours(8, 0, 0, 0); // Hora padrão 08:00:00
          return now.toISOString();
        }
      }

      // "em x minutos" ou "em x horas"
      if (/(em|daqui|daqui a) \d+ (minutos|horas)/.test(message)) {
        const timeMatch = message.match(/em (\d+) (minutos|horas)/);
        if (timeMatch) {
          const value = parseInt(timeMatch[1], 10);
          if (timeMatch[2] === "minutos") {
            now.setMinutes(now.getMinutes() + value);
          } else if (timeMatch[2] === "horas") {
            now.setHours(now.getHours() + value);
          }
          return now.toISOString();
        }
      }

      // "dia DD/MM" ou "em DD/MM/YYYY"
      if (/dia \d{1,2}\/\d{1,2}/.test(message) || /em \d{1,2}\/\d{1,2}(\/\d{4})?/.test(message)) {
        const dateMatch = message.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/);
        if (dateMatch) {
          const day = parseInt(dateMatch[1], 10);
          const month = parseInt(dateMatch[2], 10) - 1; // Meses começam em 0 no JS
          const year = dateMatch[3] ? parseInt(dateMatch[3], 10) : now.getFullYear();
          now.setFullYear(year, month, day);
          now.setHours(8, 0, 0, 0); // Hora padrão 08:00:00
          return now.toISOString();
        }
      }

      return null; // Não conseguiu interpretar
    }

    // "nova tarefa:" ou variações
    if (
      lowerCaseMessage.startsWith("nova tarefa:") ||
      lowerCaseMessage.startsWith("criar tarefa:") ||
      lowerCaseMessage.startsWith("tarefa:")
    ) {
      const description = message.replace(/^(nova tarefa:|criar tarefa:|tarefa:)/i, "").trim();
      if (description) {
        return {
          type: "task",
          description,
        };
      }
    }

    // "remover" ou "apagar"
    if (
      lowerCaseMessage.startsWith("remover ") ||
      lowerCaseMessage.startsWith("apagar ") ||
      lowerCaseMessage.startsWith("excluir ")
    ) {
      const description = message.replace(/^(remover |apagar |excluir )/i, "").trim();
      const taskIndex = dataStore[senderJid]?.tasks.findIndex((task) => task.description === description);
      const eventIndex = dataStore[senderJid]?.events.findIndex((event) => event.description === description);

      if (taskIndex !== -1) {
        return {
          type: "remove",
          target: "tasks",
          itemIndex: taskIndex,
        };
      } else if (eventIndex !== -1) {
        return {
          type: "remove",
          target: "events",
          itemIndex: eventIndex,
        };
      }
    }

    // "limpar tarefas" ou "limpar eventos"
    if (["limpar tarefas", "apagar tarefas", "remover tarefas", "excluir tarefas"].includes(lowerCaseMessage)) {
      return {
        type: "clear",
        target: "tasks",
      };
    } else if (["limpar eventos", "apagar eventos", "remover eventos", "excluir eventos"].includes(lowerCaseMessage)) {
      return {
        type: "clear",
        target: "events",
      };
    } else if (["limpar tudo", "apagar tudo", "remover tudo", "excluir tudo"].includes(lowerCaseMessage)) {
      return {
        type: "clear",
        target: "all",
      };
    }

    // detectar padrões para eventos
    if (
      /^(evento:|novo evento:|adicionar evento:)?\s?.{2,} (hoje|amanhã|em \d+ dias|em \d+ (minutos|horas)|às \d{1,2}[:h]\d{2}|em \d{1,2}\/\d{1,2}(?:\/\d{4})?)/.test(
        lowerCaseMessage
      )
    ) {
      const datetime = parseDateFromMessage(lowerCaseMessage);
      if (datetime) {
        const description = message
          .replace(
            /^(evento:|novo evento:|adicionar evento:)?\s?(hoje|amanhã|em \d+ dias|em \d+ (minutos|horas)|às \d{1,2}[:h]\d{2}|em \d{1,2}\/\d{1,2}(?:\/\d{4})?)/gi,
            ""
          )
          .trim();
        return {
          type: "event",
          description: description || "Evento sem descrição",
          datetime,
          notify: 0,
        };
      }
    }

    // alteração em tarefas ou eventos
    if (/mudar .+ para .+/.test(lowerCaseMessage)) {
      const parts = message.match(/mudar (.+) para (.+)/i);
      if (parts) {
        const targetDescription = parts[1].trim(); // Descrição do item a ser alterado
        const newDetails = parts[2].trim(); // Detalhes após "para"

        // Verifica se é tarefa ou evento
        const taskIndex = dataStore[senderJid]?.tasks.findIndex(
          (task) => task.description.toLowerCase() === targetDescription.toLowerCase()
        );
        const eventIndex = dataStore[senderJid]?.events.findIndex(
          (event) => event.description.toLowerCase() === targetDescription.toLowerCase()
        );

        if (taskIndex !== -1) {
          // Se for uma tarefa, alterar descrição
          dataStore[senderJid].tasks[taskIndex].description = newDetails;
          return {
            type: "update",
            target: "tasks",
            itemIndex: taskIndex,
            fields: { description: newDetails },
          };
        } else if (eventIndex !== -1) {
          // Se for um evento, verificar se "newDetails" é data/hora ou nova descrição
          const newDatetime = parseDateFromMessage(newDetails);
          if (newDatetime) {
            dataStore[senderJid].events[eventIndex].datetime = newDatetime;
            return {
              type: "update",
              target: "events",
              itemIndex: eventIndex,
              fields: { datetime: newDatetime },
            };
          } else {
            dataStore[senderJid].events[eventIndex].description = newDetails;
            return {
              type: "update",
              target: "events",
              itemIndex: eventIndex,
              fields: { description: newDetails },
            };
          }
        }
      }
    }

    // "consultar" ou "mostrar"
    if (["agenda", "tarefas", "eventos", "compromissos"].includes(lowerCaseMessage)) {
      return {
        type: "query",
        queryType: lowerCaseMessage === "tarefas" ? "tasks" : lowerCaseMessage === "eventos" ? "events" : "both",
      };
    }

    return null; // Caso nenhuma detecção tenha sido feita
  }

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
      scheduleEvents(); // Iniciar monitoramento de eventos
    }
  });

  sock.ev.on("creds.update", async () => {
    const userNumber = sock.user?.id?.match(/^\d+/)?.[0];

    if (userNumber) {
      if (!configStore.ownnumber) {
        consoleLogColor(`Número do bot registrado: ${userNumber}`, ConsoleColors.GREEN);
        configStore.ownnumber = userNumber;
        saveConfig();
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

      if (!msg.message || msg.key.fromMe || msg.key?.protocolMessage?.fromMe || msg.message?.protocolMessage) continue;

      const isFromGroup = msg.key.remoteJid.endsWith("@g.us");
      const messageSender = isFromGroup ? msg.key.participant : msg.key.remoteJid; // Quem enviou a mensagem
      const senderJid = isFromGroup ? msg.key.remoteJid : messageSender; // O grupo ou o número privado

      // Checar se o remetente está autorizado ou o bot está no grupo
      const isAdmin = configStore.admin.includes(messageSender);
      const isAuthorized = isAdmin || dataStore[senderJid];
      if (!isAuthorized && !isFromGroup) continue;

      if (!dataStore[senderJid]) {
        dataStore[senderJid] = isFromGroup ? structuredClone(defaultGroupData) : structuredClone(defaultUserData);
        saveData();
      }

      let messageContent =
        msg.message?.conversation ||
        msg?.message?.extendedTextMessage?.text ||
        msg?.message?.ephemeralMessage?.message?.conversation ||
        msg?.message?.ephemeralMessage?.message?.extendedTextMessage?.text ||
        "";

      // somente aceitar mensagens de grupo em menções (caso essa exigência esteja ativada)
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
        saveData();
      }

      if (/^adicionar(?: usuário| usuario)? @\d{11,15}$/i.test(messageProcessed) && isAdmin) {
        const phoneNumber = messageProcessed.match(/@\d{11,15}/)?.[0].replace("@", "");

        if (!isAdmin) {
          continue;
        }

        if (phoneNumber) {
          // adicionar a lista de autorizados
          const phoneNumberWhatsApp = phoneNumber + "@s.whatsapp.net";

          if (dataStore[phoneNumberWhatsApp]) {
            const messageText = "❌ Usuário já está autorizado.";
            await handleSendMessage(senderJid, messageText);
          } else {
            dataStore[phoneNumberWhatsApp] = structuredClone(defaultUserData);
            saveData();

            consoleLogColor(`Usuário adicionado à lista de autorizados: ${phoneNumberWhatsApp}`, ConsoleColors.GREEN);

            const messageText = "✅ Usuário adicionado.";
            await handleSendMessage(senderJid, messageText);
          }
        }

        continue;
      } else if (/^remover(?: usuário| usuario)? @\d{11,15}$/i.test(messageProcessed) && isAdmin) {
        const phoneNumber = messageProcessed.match(/@\d{11,15}/)?.[0].replace("@", "");

        if (phoneNumber) {
          // remover da lista de autorizados
          const phoneNumberWhatsApp = phoneNumber + "@s.whatsapp.net";

          if (!dataStore[phoneNumberWhatsApp]) {
            const messageText = "❌ Usuário não encontrado.";
            await handleSendMessage(senderJid, messageText);
          } else {
            delete dataStore[phoneNumberWhatsApp];
            saveData();

            consoleLogColor(`Usuário removido da lista de autorizados: ${phoneNumberWhatsApp}`, ConsoleColors.GREEN);

            const messageText = "✅ Usuário removido.";
            await handleSendMessage(senderJid, messageText);
          }
        }

        continue;
      } else if (["status"].includes(messageProcessed) && isAuthorized) {
        if (dataStore[senderJid]) {
          const messageText =
            `${dataStore[senderJid].configs.listen ? "✅ Aguardando solicitações." : "❌ Ignorando solicitações."}\n` +
            `${dataStore[senderJid].configs.notify ? "✅ Notificações ativadas." : "❌ Notificações desativadas."}` +
            `${
              dataStore[senderJid].configs.freemode !== undefined
                ? dataStore[senderJid].configs.freemode
                  ? "\n✅ Qualquer mensagem."
                  : "\n❌ Menções ativadas."
                : ""
            }` +
            `\n📋 ${
              dataStore[senderJid].tasks.length == 0
                ? "Nenhuma tarefa"
                : dataStore[senderJid].tasks.length == 1
                ? "1 tarefa"
                : `${dataStore[senderJid].tasks.length} tarefas`
            }` +
            `\n📅 ${
              dataStore[senderJid].events.length == 0
                ? "Nenhum evento"
                : dataStore[senderJid].events.length == 1
                ? "1 evento"
                : `${dataStore[senderJid].events.length} eventos`
            }` +
            "\n\n" +
            "🤖 *Comandos disponíveis:*\n" +
            `▪ *atender*: ativa/desativa novas solicitações.\n` +
            `▪ *notificar*: ativa/desativa todas notificações.\n` +
            `${
              dataStore[senderJid].configs.freemode !== undefined
                ? "▪ *livre*: ativa/desativa mensagens sem menções.\n"
                : ""
            }` +
            `▪ *agenda*: mostra tarefas e eventos.\n` +
            `▪ *tarefas*: mostra as tarefas.\n` +
            `▪ *eventos*: mostra os eventos.`;

          await handleSendMessage(senderJid, messageText);
        }

        continue;
      } else if (["atender"].includes(messageProcessed) && isAuthorized) {
        dataStore[senderJid].configs.listen = !dataStore[senderJid].configs.listen;

        const messageText = `${
          dataStore[senderJid].configs.listen
            ? "✅ Ativado, aguardando solicitações."
            : "❌ Desativado, ignorando solicitações."
        }`;
        await handleSendMessage(senderJid, messageText);
        saveData();
        continue;
      } else if (["notificar"].includes(messageProcessed) && isAuthorized) {
        dataStore[senderJid].configs.notify = !dataStore[senderJid].configs.notify;
        await handleSendMessage(
          senderJid,
          `${dataStore[senderJid].configs.notify ? "✅ Notificações ativadas." : "❌ Notificações desativadas."}`
        );
        saveData();
        continue;
      } else if (
        ["livre"].includes(messageProcessed) &&
        dataStore[senderJid].configs.freemode !== undefined &&
        isAuthorized
      ) {
        dataStore[senderJid].configs.freemode = !dataStore[senderJid].configs.freemode;
        await handleSendMessage(
          senderJid,
          `${dataStore[senderJid].configs.freemode ? "✅ Qualquer mensagem." : "❌ Menções ativadas."}`
        );
        saveData();
        continue;
      } else if (["agenda", "compromissos", "mostre", "tudo", "lista"].includes(messageProcessed)) {
        const tasks = dataStore[senderJid].tasks.map((task, i) => `*${i + 1}.* ${task.description}`).join("\n");
        const events = dataStore[senderJid].events
          .map(
            (event, i) =>
              `*${i + 1}. ${event.description}*\n   ${new Date(event.datetime).toLocaleString("pt-BR", {
                timeZone: dataStore[senderJid].configs.timezone,
                hour: "2-digit",
                minute: "2-digit",
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
              })}\n   _(notificar ${
                event.notify !== undefined && event.notify > 0
                  ? event.notify + event.notify == 1
                    ? " minuto antes"
                    : " minutos antes"
                  : "na hora do evento"
              })_`
          )
          .join("\n");

        await handleSendMessage(
          senderJid,
          (tasks && tasks.length > 0) || (events && events.length > 0)
            ? `📋 Tarefas:\n${tasks.length > 0 ? tasks : "Nenhum item encontrado"}\n\n📅 Eventos:\n${
                events.length > 0 ? events : "Nenhum item encontrado"
              }`
            : "Nenhum item encontrado."
        );

        continue;
      } else if (["tarefas"].includes(messageProcessed)) {
        const tasks = dataStore[senderJid].tasks.map((task, i) => `*${i + 1}.* ${task.description}`).join("\n");

        await handleSendMessage(
          senderJid,
          tasks && tasks.length > 0 ? `📋 Tarefas:\n${tasks}` : "Nenhuma tarefa encontrada."
        );

        continue;
      } else if (["eventos"].includes(messageProcessed)) {
        const events = dataStore[senderJid].events
          .map(
            (event, i) =>
              `*${i + 1}. ${event.description}*\n   ${new Date(event.datetime).toLocaleString("pt-BR", {
                timeZone: dataStore[senderJid].configs.timezone,
                hour: "2-digit",
                minute: "2-digit",
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
              })}\n   _(notificar ${
                event.notify !== undefined && event.notify > 0
                  ? event.notify + event.notify == 1
                    ? " minuto antes"
                    : " minutos antes"
                  : "na hora do evento"
              })_`
          )
          .join("\n");

        await handleSendMessage(
          senderJid,
          events && events.length > 0 ? `📅 Eventos:\n${events}` : "Nenhum evento encontrado."
        );

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
      const currentDateTimeISO = now.toISOString(); // ISO 8601 no UTC

      let response = interpretMessage(messageContent, currentDateTimeISO, senderJid, dataStore);

      if (response === null) {
        try {
          const openaiResponse = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: `Você é um assistente especializado em organizar eventos e tarefas. Interprete e responda solicitações de forma estruturada em JSON para gerenciar a agenda. 
              Utilize as seguintes categorias:
                - **Eventos:** JSON com "type": "event", "description", "datetime" (ISO 8601 UTC) e "notify" (em minutos; padrão 0). Inclui pedidos com tempo absoluto ou relativo especificados
                  - Para eventos: se especificado tempo relativo, como "em x minutos ou x horas" defina o tempo futuro exato a contar do atual, se tempo absoluto como "às x horas ou dia x às x horas" defina esse date-time exato.
                  - Para eventos: "notify" é o tempo em minutos antes do evento para notificação, defina sempre 0 a menos que seja explícito na solicitação ser notificado antes.
                  - Para eventos: "se especificada somente a data, defina a hora padrão como 8:00:00.
                - **Tarefas:** JSON com "type": "task" e "description". Inclui pedidos sem tempo relativo ou absoluto definido.
                - **Alterações:** JSON com "type": "update", "target": ("tasks" ou "events"), "itemIndex", e "fields" com os campos a atualizar.
                  - Para alterações: se informada nova hora ou data para um evento, considere a informação no fuso horário informado e o evento em UTC (ISO string), faça a diferença necessária, exemplo: "America/Sao_Paulo" é -3 horas do horário do campo datetime.
                - **Consultas:** JSON com "type": "query", "queryType": ("tasks", "events" ou "both").
                - **Remoções:** JSON com "type": "remove", "target" ("tasks" ou "events"), e "itemIndex".
                - **Limpeza:** JSON com "type": "clear", "target" ("tasks", "events" ou "all").
              Caso não entenda a solicitação, diga: "Desculpe, não entendi sua solicitação. Pode reformular?".`,
              },
              {
                role: "user",
                content: `Transforme a mensagem abaixo em JSON baseado nas informações fornecidas:
              - **Fuso horário:** ${dataStore[senderJid].configs.timezone || configStore.timezone}
              - **Data/hora atual em ISOstring:** ${currentDateTimeISO}
              - **Tarefas existentes:** ${JSON.stringify(dataStore[senderJid].tasks, null, 2)}
              - **Eventos existentes:** ${JSON.stringify(dataStore[senderJid].events, null, 2)}
              - **Mensagem:** "${messageContent}"`,
              },
            ],
          });

          const content = openaiResponse.choices[0].message.content.trim();
          consoleLogColor(`Resposta da OpenAI: ${content}`, ConsoleColors.RESET);

          // Verificar se a resposta é JSON
          const jsonMatch = content.match(/{[\s\S]*}/);
          if (jsonMatch) {
            response = JSON.parse(jsonMatch[0]);
            consoleLogColor("JSON processado com sucesso.", ConsoleColors.GREEN);
          } else {
            // Capturar a resposta textual para envio ao usuário
            await handleSendMessage(senderJid, content);
            continue;
          }
        } catch (error) {
          console.error("Erro ao processar JSON da OpenAI:", error);
          await handleSendMessage(senderJid, "Houve um erro ao processar sua mensagem. Tente novamente mais tarde.");
          continue;
        }
      }

      // Processar a resposta
      if (response.type === "event") {
        const notify = response.notify !== undefined ? response.notify : 0;
        dataStore[senderJid].events.push({
          description: response.description,
          datetime: response.datetime, // ISO 8601 UTC
          notify, // Minutos antes para notificação
          sender: messageSender, // Solicitante
        });

        saveData();

        await handleSendMessage(
          senderJid,
          `✅ Evento *"${response.description}"*\nAgendado para *${new Date(response.datetime).toLocaleString("pt-BR", {
            timeZone: dataStore[senderJid].configs.timezone,
            hour: "2-digit",
            minute: "2-digit",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          })}*.\nNotificação ${
            response.notify !== undefined && response.notify > 0
              ? response.notify + response.notify == 1
                ? " minuto antes."
                : " minutos antes."
              : "na hora do evento."
          }`
        );
      } else if (response.type === "task") {
        dataStore[senderJid].tasks.push({ description: response.description, sender: messageSender });
        saveData();
        await handleSendMessage(senderJid, `✅ Tarefa "${response.description}" adicionada.`);
      } else if (response.type === "update") {
        const targetList = response.target === "tasks" ? dataStore[senderJid].tasks : dataStore[senderJid].events;
        if (response.itemIndex < 0 || response.itemIndex >= targetList.length) {
          await handleSendMessage(senderJid, "❌ Índice inválido para atualização.");
          continue;
        }

        const itemToUpdate = targetList[response.itemIndex];

        if (!itemToUpdate) {
          await handleSendMessage(senderJid, `❌ Não foi possível encontrar o item para atualização.`);
          continue;
        }

        // Atualiza os campos
        if (response.fields?.datetime) {
          targetList[response.itemIndex].datetime = response.fields.datetime;
        }
        if (response.fields?.description) {
          targetList[response.itemIndex].description = response.fields.description;
        }
        if (response.fields?.notify !== undefined) {
          targetList[response.itemIndex].notify = response.fields.notify;
        }

        saveData();

        await handleSendMessage(
          senderJid,
          `✅ ${response.target === "tasks" ? "Tarefa atualizada" : "Evento atualizado"} com sucesso.\n` +
            `*${response.itemIndex + 1}.* ${targetList[response.itemIndex].description}` +
            (response.target === "events"
              ? `\n   ${new Date(targetList[response.itemIndex].datetime).toLocaleString("pt-BR", {
                  timeZone: dataStore[senderJid].configs.timezone,
                  hour: "2-digit",
                  minute: "2-digit",
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                })}\n   _(notificar ${
                  targetList[response.itemIndex].notify !== undefined && targetList[response.itemIndex].notify > 0
                    ? targetList[response.itemIndex].notify +
                      (targetList[response.itemIndex].notify === 1 ? " minuto antes" : " minutos antes")
                    : "na hora do evento"
                })_`
              : "")
        );
      } else if (response.type === "remove") {
        const targetList = response.target === "tasks" ? dataStore[senderJid].tasks : dataStore[senderJid].events;
        if (response.itemIndex < 0 || response.itemIndex >= targetList.length) {
          await handleSendMessage(senderJid, "❌ Falha na remoção.");
          continue;
        }

        if (response.itemIndex >= 0) {
          const removedItem = targetList.splice(response.itemIndex, 1)?.[0];
          saveData();

          await handleSendMessage(
            senderJid,
            `✅ ${response.target === "tasks" ? "Tarefa" : "Evento"} "${removedItem?.description}" ${
              response.target === "tasks" ? "removida" : "removido"
            }.`
          );
        } else {
          await handleSendMessage(senderJid, "❌ Não foi possível encontrar o item para remoção.");
        }
      } else if (response.type === "clear") {
        if (response.target === "tasks" || response.target === "all") {
          dataStore[senderJid].tasks = [];
        }
        if (response.target === "events" || response.target === "all") {
          dataStore[senderJid].events = [];
        }
        saveData();

        await handleSendMessage(
          senderJid,
          `✅ Lista ${
            response.target === "tasks" ? "de tarefas" : response.target === "events" ? "de eventos" : "completa"
          } foi limpa com sucesso.`
        );
      } else if (response.type === "query") {
        const tasks = dataStore[senderJid].tasks.map((task, i) => `*${i + 1}.* ${task.description}`).join("\n");
        const events = dataStore[senderJid].events
          .map(
            (event, i) =>
              `*${i + 1}. ${event.description}*\n   ${new Date(event.datetime).toLocaleString("pt-BR", {
                timeZone: dataStore[senderJid].configs.timezone,
                hour: "2-digit",
                minute: "2-digit",
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
              })}\n   _(notificar ${
                event.notify !== undefined && event.notify > 0
                  ? event.notify + event.notify == 1
                    ? " minuto antes"
                    : " minutos antes"
                  : "na hora do evento"
              })_`
          )
          .join("\n");

        await handleSendMessage(
          senderJid,
          (tasks && tasks.length > 0) || (events && events.length > 0)
            ? `📋 Tarefas:\n${tasks}\n\n📅 Eventos:\n${events}`
            : "Nenhum item encontrado."
        );
      } else {
        await handleSendMessage(senderJid, "Não entendi sua solicitação. Reformule, por favor.");
      }
    }
  });
}

// Iniciar o bot
const startApp = async () => {
  await clearOldFiles("./auth", 2);
  ({ state, saveCreds } = await useMultiFileAuthState("auth"));
  currentVersion = await getWhatsAppVersion();

  runWhatsAppBot();
};

startApp();
