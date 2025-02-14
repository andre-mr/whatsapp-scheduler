/**
 * Interprets incoming messages and converts them to structured commands
 * @param {string} message - The message content to interpret
 * @param {string} currentDateTimeISO - Current datetime in ISO format
 * @param {string} senderJid - The sender's JID
 * @param {Object} dataStore - The data store containing user/group data
 * @returns {Object|null} Structured command object or null if message not understood
 */
export function interpretMessage(message, currentDateTimeISO, senderJid, dataStore) {
  const lowerCaseMessage = message.toLowerCase().trim();

  // Function to parse date from message
  function parseDateFromMessage(message) {
    const now = new Date(currentDateTimeISO);

    // "dia DD/MM" ou "dia DD/MM/YYYY" com horário opcional
    if (/(dia) \d{1,2}\/\d{1,2}(\/\d{4})?/.test(message)) {
      const dateMatch = message.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/);
      const timeMatch = message.match(/às (\d{1,2})(?:[h:](\d{2}))?/);

      if (dateMatch) {
        const day = parseInt(dateMatch[1], 10);
        const month = parseInt(dateMatch[2], 10) - 1;
        const year = dateMatch[3] ? parseInt(dateMatch[3], 10) : now.getFullYear();

        now.setFullYear(year, month, day);

        if (timeMatch) {
          const hours = parseInt(timeMatch[1], 10);
          const minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
          now.setHours(hours, minutes, 0, 0);
        } else {
          now.setHours(8, 0, 0, 0);
        }

        return now.toISOString();
      }
    }

    // "amanhã"
    if (/(amanhã às|amanhã) (\d{1,2}:\d{2}:\d{2}|\d{1,2}:\d{2}|\d{1,2})/.test(message)) {
      const timeMatch = message.match(/\d{1,2}(?::\d{2}(?::\d{2})?)?/);
      if (timeMatch) {
        const [hours, minutes = 0, seconds = 0] = timeMatch[0].split(":").map(Number);
        now.setDate(now.getDate() + 1);
        now.setHours(hours, minutes, seconds, 0);
        return now.toISOString();
      }
    }

    // "hoje"
    if (/(hoje às|hoje|às) (\d{1,2}:\d{2}:\d{2}|\d{1,2}:\d{2}|\d{1,2})/.test(message)) {
      const timeMatch = message.match(/\d{1,2}(?::\d{2}(?::\d{2})?)?/);
      if (timeMatch) {
        const [hours, minutes = 0, seconds = 0] = timeMatch[0].split(":").map(Number);
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
        now.setHours(8, 0, 0, 0);
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

    return null;
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

  // alteração em tarefas ou eventos
  if (/mudar .+ para .+/.test(lowerCaseMessage)) {
    const parts = message.match(/mudar (.+) para (.+)/i);
    if (parts) {
      const targetDescription = parts[1].trim();
      const newDetails = parts[2].trim();

      const taskIndex = dataStore[senderJid]?.tasks.findIndex(
        (task) => task.description.toLowerCase() === targetDescription.toLowerCase()
      );
      const eventIndex = dataStore[senderJid]?.events.findIndex(
        (event) => event.description.toLowerCase() === targetDescription.toLowerCase()
      );

      if (taskIndex !== -1) {
        return {
          type: "update",
          target: "tasks",
          itemIndex: taskIndex,
          fields: { description: newDetails },
        };
      } else if (eventIndex !== -1) {
        const newDatetime = parseDateFromMessage(newDetails);
        if (newDatetime) {
          return {
            type: "update",
            target: "events",
            itemIndex: eventIndex,
            fields: { datetime: newDatetime },
          };
        } else {
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

  // detectar padrões para eventos
  if (
    /^(evento:|novo evento:|adicionar evento:)?\s?.{2,} (hoje|amanhã|em \d+ dias|em \d+ (minutos|horas)|às \d{1,2}[:h]\d{2}|em \d{1,2}\/\d{1,2}(?:\/\d{4})?)/.test(
      lowerCaseMessage
    )
  ) {
    const datetime = parseDateFromMessage(lowerCaseMessage);
    if (datetime) {
      const description = message
        .replace(/^(evento:|novo evento:|adicionar evento:)?\s?/, "")
        .replace(/(?:hoje|amanhã|dia ).*/i, "")
        .replace(/(em \d+ dias?|em \d+ (minutos?|horas?)|às \d{1,2}[:h]\d{2}|em \d{1,2}\/\d{1,2}(?:\/\d{4})?)\b/g, "")
        .trim();

      return {
        type: "event",
        description: description || "Evento sem descrição",
        datetime,
        notify: 0,
      };
    }
  }

  // "consultar" ou "mostrar"
  if (["agenda", "tarefas", "eventos", "compromissos"].includes(lowerCaseMessage)) {
    return {
      type: "query",
      queryType: lowerCaseMessage === "tarefas" ? "tasks" : lowerCaseMessage === "eventos" ? "events" : "both",
    };
  }

  return null;
}
