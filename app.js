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

// Dados em memória para agendamentos
const dataStore = {
  events: [],
  tasks: [],
  authorized: [], // Substitua pelos números autorizados
  timezone: -3,
  waversion: [2, 3000, 1015901307],
};

const dataFilePath = path.join(__dirname, "./modules/data.json");

// Funções para manipular dados persistentes
function saveData() {
  fs.writeFileSync(dataFilePath, JSON.stringify(dataStore, null, 2));
}

function loadData() {
  if (fs.existsSync(dataFilePath)) {
    const rawData = fs.readFileSync(dataFilePath, "utf8");
    Object.assign(dataStore, JSON.parse(rawData));
  } else {
    // Criar arquivo com valores padrão caso não exista
    fs.writeFileSync(dataFilePath, JSON.stringify(dataStore, null, 2));
    consoleLogColor("Arquivo data.json criado com valores padrão.", ConsoleColors.YELLOW);
  }
}

loadData();

let state, saveCreds, currentVersion, sock;
let reconnectionAttempts = 1;

// Função para obter a versão do WhatsApp
async function getWhatsAppVersion() {
  const latestVersionCustom = await fetchWhatsAppVersion();
  const configVersion = dataStore.waversion;

  const compareVersions = (v1, v2) => {
    for (let i = 0; i < 3; i++) {
      if (v1[i] > v2[i]) return v1;
      if (v2[i] > v1[i]) return v2;
    }
    return v1;
  };

  const currentVersion = compareVersions(configVersion, latestVersionCustom || []);

  if (!configVersion.every((v, i) => v === currentVersion[i])) {
    consoleLogColor(`Versão do WhatsApp: ${currentVersion.join(".")}`, ConsoleColors.CYAN);
    dataStore.waversion = currentVersion;
    saveData();
  }

  return currentVersion;
}

// Limpeza de arquivos antigos
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

// Função para verificar eventos e disparar mensagens
function scheduleEvents() {
  setInterval(async () => {
    const now = new Date();

    // Filtrar eventos que devem ser notificados
    const dueEvents = dataStore.events.filter((event) => {
      const eventTime = new Date(event.datetime);
      const notifyTime = new Date(eventTime.getTime() - (event.notify || 0) * 60 * 1000);
      const delayLimit = new Date(notifyTime.getTime() + 60 * 60 * 1000); // Permitir até 60 minutos após o horário de notificação
      return now >= notifyTime && now <= delayLimit; // Agora está dentro da janela de notificação
    });

    for (const event of dueEvents) {
      // Enviar mensagem ao solicitante
      try {
        await sock.sendMessage(event.sender, {
          text: `⏰ "${event.description}"\nEm: ${new Date(
            new Date(event.datetime).getTime() + dataStore.timezone * 60 * 60 * 1000
          ).toLocaleString("pt-BR")}.`,
        });
        consoleLogColor(`Lembrete enviado para ${event.sender}: "${event.description}"`, ConsoleColors.GREEN);
        // Remover evento após enviar notificação com sucesso
        dataStore.events = dataStore.events.filter((e) => e !== event);
      } catch (error) {
        consoleLogColor(`Erro ao enviar lembrete para ${event.sender}: ${error}`, ConsoleColors.RED);
      }
    }

    // Remover eventos passados
    dataStore.events = dataStore.events.filter((event) => new Date(event.datetime) > now);
    saveData();
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

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "close") {
      console.log("reason:", lastDisconnect.error?.output?.statusCode);
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
    saveCreds();
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const isFromGroup = msg.key.remoteJid.endsWith("@g.us");
      const actualSender = isFromGroup ? msg.key.participant : msg.key.remoteJid; // Quem enviou a mensagem
      const sender = isFromGroup ? msg.key.remoteJid : actualSender; // O grupo ou o número privado

      // Checar se o remetente (quem enviou) está autorizado
      const isAuthorized = dataStore.authorized.includes(actualSender);

      if (!isAuthorized) continue;

      const messageContent = msg.message?.conversation || msg?.message?.extendedTextMessage?.text || "";
      consoleLogColor(`Mensagem recebida: ${messageContent}`, ConsoleColors.BRIGHT);

      const key = {
        remoteJid: msg.key.remoteJid,
        id: msg.key.id,
        participant: msg?.participant || undefined,
      };
      sock.readMessages([key]);

      const now = new Date();
      const currentDateTimeISO = now.toISOString(); // ISO 8601 no UTC
      // const timezoneOffsetMinutes = new Date().getTimezoneOffset(); // Exemplo: -180 para GMT-3
      const timezoneOffsetMinutes = dataStore.timezone * 60; // Exemplo: -180 para GMT-3
      const timezoneString = `UTC${timezoneOffsetMinutes <= 0 ? "+" : "-"}${Math.abs(timezoneOffsetMinutes) / 60}`;

      let response;
      try {
        const openaiResponse = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `Você é um assistente para agendamento e organização. 
                Sua função é interpretar solicitações para adicionar, alterar ou remover eventos e tarefas, listar itens, ou limpar listas.
                Quando fornecer um agendamento, considere que o usuário está no fuso horário ${timezoneString}.
                Retorne o seguinte:
                  - Para eventos: JSON com "type": "event", "description", "datetime" (ISO 8601 UTC), e "notify" (minutos antes para notificação, padrão 30).
                    - **Solicitações que contenham palavras como "me lembre", "lembrete", ou frases indicando um horário específico (ex.: "em X minutos", "às Y horas") devem ser interpretadas como eventos**.
                    - Se a mensagem mencionar um tempo relativo (ex.: "em 10 minutos"), calcule o horário adicionando o tempo especificado à data/hora atual e defina notify como 0.
                  - Para alterações: JSON com "type": "update", "target": "tasks | events", "itemIndex", e os campos a serem atualizados.
                  - Para tarefas: JSON com "type": "task" e "description".
                  - Para consultas: JSON com "type": "query" e "queryType" ("tasks | events | both").
                  - Para remoções: JSON com "type": "remove", "target" ("tasks | events"), e "itemIndex".
                  - Para limpar listas: JSON com "type": "clear" e "target" ("tasks | events | all").
                Se não entender a solicitação, responda com: "Desculpe, não entendi sua solicitação. Pode reformular?".`,
            },
            {
              role: "user",
              content: `
                Transforme a seguinte mensagem em um JSON estruturado com base nas listas fornecidas:
                Fuso horário: ${timezoneString}
                Data/hora atual: ${currentDateTimeISO}
                Lista atual de tarefas: ${JSON.stringify(
                  dataStore.tasks.filter((task) => task.sender === sender),
                  null,
                  2
                )}
                Lista atual de eventos: ${JSON.stringify(
                  dataStore.events.filter((event) => event.sender === sender),
                  null,
                  2
                )}
                Mensagem: "${messageContent}"
              `,
            },
          ],
        });

        const content = openaiResponse.choices[0].message.content.trim();

        // Verificar se a resposta é JSON
        const jsonMatch = content.match(/{[\s\S]*}/);
        if (jsonMatch) {
          response = JSON.parse(jsonMatch[0]);
          consoleLogColor("JSON processado com sucesso.", ConsoleColors.GREEN);
        } else {
          // Capturar a resposta textual para envio ao usuário
          await sock.sendMessage(sender, { text: content });
          continue;
        }
      } catch (error) {
        console.error("Erro ao processar JSON da OpenAI:", error);
        await sock.sendMessage(sender, {
          text: "Houve um erro ao processar sua mensagem. Tente novamente mais tarde.",
        });
        continue;
      }

      // Processar a resposta
      if (response.type === "event") {
        const notify = response.notify !== undefined ? response.notify : 30; // Corrigido
        dataStore.events.push({
          description: response.description,
          datetime: response.datetime, // ISO 8601 UTC
          notify, // Minutos antes para notificação
          sender: sender, // Destinatário (grupo ou número privado)
        });

        saveData();

        await sock.sendMessage(sender, {
          text: `✅ Evento "${response.description}" agendado para ${new Date(
            new Date(response.datetime).getTime() + dataStore.timezone * 60 * 60 * 1000
          ).toLocaleString("pt-BR")}. Notificação ${
            response.notify && response.notify > 0
              ? response.notify + response.notify == 1
                ? " minuto antes"
                : " minutos antes"
              : "na hora do evento"
          }`,
        });
      } else if (response.type === "task") {
        dataStore.tasks.push({ description: response.description, sender: sender });
        saveData();
        await sock.sendMessage(sender, {
          text: `✅ Tarefa "${response.description}" adicionada.`,
        });
      } else if (response.type === "update") {
        const targetList = response.target === "tasks" ? dataStore.tasks : dataStore.events;
        const filteredList = targetList.filter((item) => item.sender === sender);
        const item = filteredList[response.itemIndex];

        if (item) {
          // Atualiza os campos diretamente com base na resposta
          if (response.datetime) {
            item.datetime = response.datetime; // Atualiza datetime
          }
          if (response.description) {
            item.description = response.description; // Atualiza descrição, se fornecida
          }
          if (response.notify !== undefined) {
            item.notify = response.notify; // Atualiza tempo de notificação, se fornecido
          }

          saveData();

          await sock.sendMessage(sender, {
            text: `✅ ${response.target === "tasks" ? "Tarefa" : "Evento"} atualizado com sucesso.`,
          });
        } else {
          await sock.sendMessage(sender, {
            text: `❌ Não foi possível encontrar o item para atualização.`,
          });
        }
      } else if (response.type === "remove") {
        const targetList = response.target === "tasks" ? dataStore.tasks : dataStore.events;
        const filteredList = targetList.filter((item) => item.sender === sender);
        const removedItem = filteredList.splice(response.itemIndex, 1);
        saveData();

        await sock.sendMessage(sender, {
          text: `✅ ${response.target === "tasks" ? "Tarefa" : "Evento"} "${
            removedItem[0]?.description
          }" foi removido.`,
        });
      } else if (response.type === "clear") {
        if (response.target === "tasks" || response.target === "all") {
          dataStore.tasks = dataStore.tasks.filter((task) => task.sender !== sender);
        }
        if (response.target === "events" || response.target === "all") {
          dataStore.events = dataStore.events.filter((event) => event.sender !== sender);
        }
        saveData();

        await sock.sendMessage(sender, {
          text: `✅ Lista ${
            response.target === "tasks" ? "de tarefas" : response.target === "events" ? "de eventos" : "completa"
          } foi limpa com sucesso.`,
        });
      } else if (response.type === "query") {
        const tasks = dataStore.tasks
          .filter((task) => task.sender === sender)
          .map((task, i) => `${i + 1}. ${task.description}`)
          .join("\n");
        const events = dataStore.events
          .filter((event) => event.sender === sender)
          .map(
            (event, i) =>
              `${i + 1}. ${event.description}\n   ${new Date(
                new Date(event.datetime).getTime() + dataStore.timezone * 60 * 60 * 1000
              ).toLocaleString("pt-BR")}\n   (notificar ${
                event.notify && event.notify > 0
                  ? event.notify + event.notify == 1
                    ? " minuto antes"
                    : " minutos antes"
                  : "na hora do evento"
              })`
          )
          .join("\n\n");

        await sock.sendMessage(sender, {
          text:
            (tasks && tasks.length > 0) || (events && events.length > 0)
              ? `📋 Tarefas:\n${tasks}\n\n📅 Eventos:\n${events}`
              : "Nenhum item encontrado.",
        });
      } else {
        await sock.sendMessage(sender, { text: "Não entendi sua solicitação. Reformule, por favor." });
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
