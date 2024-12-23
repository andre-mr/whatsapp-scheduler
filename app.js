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
  ownnumber: "",
  authorized: [], // Substitua pelos números autorizados
  notify: true, // Notificações ativas
  listen: true, // Atende solicitações
  mentions: true, // Responder apenas a menções
  timezone: "America/Sao_Paulo",
  waversion: [2, 3000, 1015901307],
};

const dataFilePath = path.join(__dirname, "./modules/data.json");

// Funções para manipular dados persistentes
function saveData() {
  fs.writeFileSync(dataFilePath, JSON.stringify(dataStore, null, 2));
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

loadData();

let state, saveCreds, currentVersion, sock;

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

    // Expurgo de eventos passados, independentemente de notificações ativas
    dataStore.events = dataStore.events.filter((event) => {
      const eventTime = new Date(event.datetime);
      const notifyTime = new Date(eventTime.getTime() - (event.notify || 0) * 60 * 1000);
      const delayLimit = new Date(notifyTime.getTime() + 60 * 60 * 1000); // Permitir até 60 minutos após o horário de notificação

      return now <= delayLimit; // Manter eventos dentro da janela de tolerância
    });

    if (!dataStore.notify) {
      saveData(); // Garantir que o expurgo seja persistido mesmo sem notificações
      return; // Sem notificações, sair da função
    }

    // Filtrar eventos que devem ser notificados
    const dueEvents = dataStore.events.filter((event) => {
      const eventTime = new Date(event.datetime);
      const notifyTime = new Date(eventTime.getTime() - (event.notify || 0) * 60 * 1000);
      return now >= notifyTime; // Dentro do horário de notificação
    });

    for (const event of dueEvents) {
      // Enviar mensagem ao solicitante
      try {
        await sock.sendMessage(event.sender, {
          text: `⏰ *${event.description}*\nEm: ${new Date(event.datetime).toLocaleString("pt-BR", {
            timeZone: dataStore.timezone,
          })}.`,
        });
        consoleLogColor(`Lembrete enviado para ${event.sender}: "${event.description}"`, ConsoleColors.GREEN);
        // Remover evento após enviar notificação com sucesso
        dataStore.events = dataStore.events.filter((e) => e !== event);
      } catch (error) {
        consoleLogColor(`Erro ao enviar lembrete para ${event.sender}: ${error}`, ConsoleColors.RED);
      }
    }

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
      if (!dataStore.ownnumber) {
        consoleLogColor(`Número do bot registrado: ${userNumber}`, ConsoleColors.GREEN);
        dataStore.ownnumber = userNumber;
        saveData();
      }
    }

    saveCreds();
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    for (const msg of messages) {
      const expirationTime = msg.message?.ephemeralMessage?.message?.extendedTextMessage?.contextInfo?.expiration || 0;
      sock.readMessages([msg.key]);

      if (!msg.message || msg.key.fromMe || msg.key?.protocolMessage?.fromMe || msg.message?.protocolMessage) continue;

      const isFromGroup = msg.key.remoteJid.endsWith("@g.us");
      const actualSender = isFromGroup ? msg.key.participant : msg.key.remoteJid; // Quem enviou a mensagem
      const sender = isFromGroup ? msg.key.remoteJid : actualSender; // O grupo ou o número privado

      // Checar se o remetente (quem enviou) está autorizado
      const isAuthorized = dataStore.authorized.includes(actualSender);
      if (!isAuthorized) continue;

      let messageContent =
        msg.message?.conversation ||
        msg?.message?.extendedTextMessage?.text ||
        msg?.message?.ephemeralMessage?.message?.conversation ||
        msg?.message?.ephemeralMessage?.message?.extendedTextMessage?.text ||
        "";

      // somente aceitar mensagens de grupo em menções se essa opção estiver ativada
      if (isFromGroup && dataStore.mentions && !messageContent.includes(`@${dataStore.ownnumber}`)) {
        continue;
      }

      const messageProcessed = messageContent.replace(`@${dataStore.ownnumber}`, "").trim().toLowerCase();

      if (/^adicionar(?: usuário| usuario)? @\d{11,15}$/i.test(messageProcessed)) {
        const phoneNumber = messageProcessed.match(/@\d{11,15}/)?.[0].replace("@", "");

        if (phoneNumber) {
          // adicionar a lista de autorizados
          const phoneNumberWhatsApp = phoneNumber + "@s.whatsapp.net";
          if (dataStore.authorized.includes(phoneNumberWhatsApp)) {
            await sock.sendMessage(sender, {
              text: "❌ Usuário já está autorizado.",
            });
          } else {
            dataStore.authorized.push(phoneNumberWhatsApp);
            saveData();

            consoleLogColor(`Usuário adicionado à lista de autorizados: ${phoneNumberWhatsApp}`, ConsoleColors.GREEN);
            await sock.sendMessage(sender, {
              text: "✅ Usuário adicionado.",
            });
          }
        }

        continue;
      } else if (/^remover(?: usuário| usuario)? @\d{11,15}$/i.test(messageProcessed)) {
        const phoneNumber = messageProcessed.match(/@\d{11,15}/)?.[0].replace("@", "");

        if (phoneNumber) {
          // remover da lista de autorizados
          const phoneNumberWhatsApp = phoneNumber + "@s.whatsapp.net";
          if (dataStore.authorized.includes(phoneNumberWhatsApp)) {
            if (dataStore.authorized.length <= 1) {
              await sock.sendMessage(sender, {
                text: "❌ Não é possível remover o único usuário autorizado.",
              });

              continue;
            }
            dataStore.authorized = dataStore.authorized.filter((num) => num !== phoneNumberWhatsApp);
            saveData();

            consoleLogColor(`Usuário removido da lista de autorizados: ${phoneNumberWhatsApp}`, ConsoleColors.GREEN);
            await sock.sendMessage(sender, {
              text: "✅ Usuário removido.",
            });
          } else {
            await sock.sendMessage(sender, {
              text: "❌ Usuário não encontrado.",
            });
          }
        }

        continue;
      } else if (["status"].includes(messageProcessed)) {
        const messageText =
          "🟢 *Agente online*\n" +
          `${dataStore.listen ? "✅ Aguardando solicitações." : "❌ Ignorando solicitações."}\n` +
          `${dataStore.notify ? "✅ Notificações ativadas." : "❌ Notificações desativadas."}` +
          "\n\n" +
          "🤖 *Comandos disponíveis:*\n" +
          `▪ *atender*: ativa/desativa todas solicitações.\n` +
          `▪ *notificar*: ativa/desativa todas notificações.\n` +
          `▪ *agenda*: mostra tarefas e eventos do grupo ou contato.\n` +
          `▪ *tarefas*: mostra as tarefas do grupo ou contato.\n` +
          `▪ *eventos*: mostra os eventos do grupo ou contato.`;
        if (expirationTime > 0) {
          await sock.sendMessage(sender, { disappearingMessagesInChat: expirationTime });
          await sock.sendMessage(sender, { text: messageText }, { ephemeralExpiration: expirationTime });
        } else {
          await sock.sendMessage(sender, {
            text: messageText,
          });
        }

        continue;
      } else if (["atender"].includes(messageProcessed)) {
        dataStore.listen = !dataStore.listen;
        await sock.sendMessage(sender, {
          text: `${
            dataStore.listen ? "✅ Ativado, aguardando solicitações." : "❌ Desativado, ignorando solicitações."
          }`,
        });
        continue;
      } else if (["notificar"].includes(messageProcessed)) {
        dataStore.notify = !dataStore.notify;
        await sock.sendMessage(sender, {
          text: `${dataStore.notify ? "✅ Notificações ativadas." : "❌ Notificações desativadas."}`,
        });
        continue;
      } else if (["agenda", "compromissos", "mostre", "tudo", "lista"].includes(messageProcessed)) {
        const tasks = dataStore.tasks
          .filter((task) => task.sender === sender)
          .map((task, i) => `*${i + 1}.* ${task.description}`)
          .join("\n");
        const events = dataStore.events
          .filter((event) => event.sender === sender)
          .map(
            (event, i) =>
              `*${i + 1}. ${event.description}*\n   ${new Date(event.datetime).toLocaleString("pt-BR", {
                timeZone: dataStore.timezone,
              })}\n   _(notificar ${
                event.notify !== undefined && event.notify > 0
                  ? event.notify + event.notify == 1
                    ? " minuto antes"
                    : " minutos antes"
                  : "na hora do evento"
              })_`
          )
          .join("\n");

        await sock.sendMessage(sender, {
          text:
            (tasks && tasks.length > 0) || (events && events.length > 0)
              ? `📋 Tarefas:\n${tasks}\n\n📅 Eventos:\n${events}`
              : "Nenhum item encontrado.",
        });

        continue;
      } else if (["tarefas"].includes(messageProcessed)) {
        const tasks = dataStore.tasks
          .filter((task) => task.sender === sender)
          .map((task, i) => `*${i + 1}.* ${task.description}`)
          .join("\n");

        await sock.sendMessage(sender, {
          text: tasks && tasks.length > 0 ? `📋 Tarefas:\n${tasks}` : "Nenhum item encontrado.",
        });

        continue;
      } else if (["eventos"].includes(messageProcessed)) {
        const events = dataStore.events
          .filter((event) => event.sender === sender)
          .map(
            (event, i) =>
              `*${i + 1}. ${event.description}*\n   ${new Date(event.datetime).toLocaleString("pt-BR", {
                timeZone: dataStore.timezone,
              })}\n   _(notificar ${
                event.notify !== undefined && event.notify > 0
                  ? event.notify + event.notify == 1
                    ? " minuto antes"
                    : " minutos antes"
                  : "na hora do evento"
              })_`
          )
          .join("\n");

        await sock.sendMessage(sender, {
          text: events && events.length > 0 ? `📅 Eventos:\n${events}` : "Nenhum item encontrado.",
        });

        continue;
      }

      if (!dataStore.listen) {
        continue;
      } else if (["adicionar usuario", "adicionar usuário"].includes(messageProcessed)) {
        //
      }

      if (messageContent.includes(`@${dataStore.ownnumber}`)) {
        messageContent = messageContent.replace(`@${dataStore.ownnumber}`, "").trim();
      }

      consoleLogColor(`Mensagem recebida de ${sender}: ${messageContent}`, ConsoleColors.BRIGHT);

      const now = new Date();
      const currentDateTimeISO = now.toISOString(); // ISO 8601 no UTC

      let response;
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
              - **Fuso horário:** ${dataStore.timezone}
              - **Data/hora atual em ISOstring:** ${currentDateTimeISO}
              - **Tarefas existentes:** ${JSON.stringify(
                dataStore.tasks.filter((task) => task.sender === sender),
                null,
                2
              )}
              - **Eventos existentes:** ${JSON.stringify(
                dataStore.events.filter((event) => event.sender === sender),
                null,
                2
              )}
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
        const notify = response.notify !== undefined ? response.notify : 0;
        dataStore.events.push({
          description: response.description,
          datetime: response.datetime, // ISO 8601 UTC
          notify, // Minutos antes para notificação
          sender: sender, // Destinatário (grupo ou número privado)
        });

        saveData();

        await sock.sendMessage(sender, {
          text: `✅ Evento *"${response.description}"*\nAgendado para *${new Date(response.datetime).toLocaleString(
            "pt-BR",
            { timeZone: dataStore.timezone }
          )}*.\nNotificação ${
            response.notify !== undefined && response.notify > 0
              ? response.notify + response.notify == 1
                ? " minuto antes."
                : " minutos antes."
              : "na hora do evento."
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

        if (response.itemIndex < 0 || response.itemIndex >= filteredList.length) {
          await sock.sendMessage(sender, {
            text: "❌ Índice inválido para atualização.",
          });
          continue;
        }

        const itemToUpdate = filteredList[response.itemIndex];
        const originalIndex = targetList.indexOf(itemToUpdate);

        if (originalIndex === -1) {
          await sock.sendMessage(sender, {
            text: `❌ Não foi possível encontrar o item para atualização.`,
          });
          continue;
        }

        // Atualiza os campos diretamente no array original
        if (response.fields?.datetime) {
          targetList[originalIndex].datetime = response.fields.datetime;
        }
        if (response.fields?.description) {
          targetList[originalIndex].description = response.fields.description;
        }
        if (response.fields?.notify !== undefined) {
          targetList[originalIndex].notify = response.fields?.notify;
        }

        saveData();

        await sock.sendMessage(sender, {
          text:
            `✅ ${response.target === "tasks" ? "Tarefa atualizada" : "Evento atualizado"} com sucesso.\n` +
            `*${response.itemIndex + 1}.* ${targetList[originalIndex].description}` +
            (response.target === "events"
              ? `\n   ${new Date(targetList[originalIndex].datetime).toLocaleString("pt-BR", {
                  timeZone: dataStore.timezone,
                })}\n   _(notificar ${
                  targetList[originalIndex].notify !== undefined && targetList[originalIndex].notify > 0
                    ? targetList[originalIndex].notify +
                      (targetList[originalIndex].notify === 1 ? " minuto antes" : " minutos antes")
                    : "na hora do evento"
                })_`
              : ""),
        });
      } else if (response.type === "remove") {
        const targetList = response.target === "tasks" ? dataStore.tasks : dataStore.events;
        const filteredList = targetList.filter((item) => item.sender === sender);

        if (response.itemIndex < 0 || response.itemIndex >= filteredList.length) {
          sock.sendMessage(sender, {
            text: "❌ Falha na remoção.",
          });
          continue;
        }

        // const removedItem = filteredList.splice(response.itemIndex, 1);
        const itemToRemove = filteredList[response.itemIndex];
        const originalIndex = targetList.indexOf(itemToRemove);

        if (originalIndex !== -1) {
          const removedItem = targetList.splice(originalIndex, 1);
          saveData();

          await sock.sendMessage(sender, {
            text: `✅ ${response.target === "tasks" ? "Tarefa" : "Evento"} "${removedItem[0]?.description}" ${
              response.target === "tasks" ? "removida" : "removido"
            }.`,
          });
        } else {
          await sock.sendMessage(sender, {
            text: "❌ Não foi possível encontrar o item para remoção.",
          });
        }
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
          .map((task, i) => `*${i + 1}.* ${task.description}`)
          .join("\n");
        const events = dataStore.events
          .filter((event) => event.sender === sender)
          .map(
            (event, i) =>
              `*${i + 1}. ${event.description}*\n   ${new Date(event.datetime).toLocaleString("pt-BR", {
                timeZone: dataStore.timezone,
              })}\n   _(notificar ${
                event.notify !== undefined && event.notify > 0
                  ? event.notify + event.notify == 1
                    ? " minuto antes"
                    : " minutos antes"
                  : "na hora do evento"
              })_`
          )
          .join("\n");

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
