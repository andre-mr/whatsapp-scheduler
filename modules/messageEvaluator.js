import { consoleLogColor } from "./utils.js";
import { ConsoleColors } from "./constants.js";

export async function evaluateMessage(
  messageProcessed,
  { isAdmin, dataStore, defaultUserData, senderJid, handleSendMessage, saveData, isAuthorized }
) {
  if (/^adicionar(?: usuário| usuario)? @\d{11,15}$/i.test(messageProcessed) && isAdmin) {
    const phoneNumber = messageProcessed.match(/@\d{11,15}/)?.[0].replace("@", "");

    if (!isAdmin) {
      return true; // continue
    }

    if (phoneNumber) {
      const phoneNumberWhatsApp = phoneNumber + "@s.whatsapp.net";

      if (dataStore[phoneNumberWhatsApp]) {
        await handleSendMessage(senderJid, "❌ Usuário já está autorizado.");
      } else {
        dataStore[phoneNumberWhatsApp] = structuredClone(defaultUserData);
        saveData(dataStore);

        consoleLogColor(`Usuário adicionado à lista de autorizados: ${phoneNumberWhatsApp}`, ConsoleColors.GREEN);
        await handleSendMessage(senderJid, "✅ Usuário adicionado.");
      }
    }

    return true; // continue
  } else if (/^remover(?: usuário| usuario)? @\d{11,15}$/i.test(messageProcessed) && isAdmin) {
    const phoneNumber = messageProcessed.match(/@\d{11,15}/)?.[0].replace("@", "");

    if (phoneNumber) {
      const phoneNumberWhatsApp = phoneNumber + "@s.whatsapp.net";

      if (!dataStore[phoneNumberWhatsApp]) {
        await handleSendMessage(senderJid, "❌ Usuário não encontrado.");
      } else {
        delete dataStore[phoneNumberWhatsApp];
        saveData(dataStore);

        consoleLogColor(`Usuário removido da lista de autorizados: ${phoneNumberWhatsApp}`, ConsoleColors.GREEN);
        await handleSendMessage(senderJid, "✅ Usuário removido.");
      }
    }

    return true; // continue
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

    return true; // continue
  } else if (["atender"].includes(messageProcessed) && isAuthorized) {
    dataStore[senderJid].configs.listen = !dataStore[senderJid].configs.listen;

    const messageText = `${
      dataStore[senderJid].configs.listen
        ? "✅ Ativado, aguardando solicitações."
        : "❌ Desativado, ignorando solicitações."
    }`;
    await handleSendMessage(senderJid, messageText);
    saveData(dataStore);
    return true; // continue
  } else if (["notificar"].includes(messageProcessed) && isAuthorized) {
    dataStore[senderJid].configs.notify = !dataStore[senderJid].configs.notify;
    await handleSendMessage(
      senderJid,
      `${dataStore[senderJid].configs.notify ? "✅ Notificações ativadas." : "❌ Notificações desativadas."}`
    );
    saveData(dataStore);
    return true; // continue
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
    saveData(dataStore);
    return true; // continue
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

    return true; // continue
  } else if (["tarefas"].includes(messageProcessed)) {
    const tasks = dataStore[senderJid].tasks.map((task, i) => `*${i + 1}.* ${task.description}`).join("\n");

    await handleSendMessage(
      senderJid,
      tasks && tasks.length > 0 ? `📋 Tarefas:\n${tasks}` : "Nenhuma tarefa encontrada."
    );

    return true; // continue
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

    return true; // continue
  }

  return false; // Don't continue
}
