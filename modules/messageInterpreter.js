export function interpretMessage(message, currentDateTimeISO, senderJid, dataStore) {
  const lowerCaseMessage = message.toLowerCase().trim();

  // Function to parse date from message
  function parseDateFromMessage(message) {
    const now = new Date(currentDateTimeISO);

    // "day DD/MM" or "day DD/MM/YYYY" with optional time
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

    // "tomorrow"
    if (/(amanhã às|amanhã) (\d{1,2}:\d{2}:\d{2}|\d{1,2}:\d{2}|\d{1,2})/.test(message)) {
      const timeMatch = message.match(/\d{1,2}(?::\d{2}(?::\d{2})?)?/);
      if (timeMatch) {
        const [hours, minutes = 0, seconds = 0] = timeMatch[0].split(":").map(Number);
        now.setDate(now.getDate() + 1);
        now.setHours(hours, minutes, seconds, 0);
        return now.toISOString();
      }
    }

    // "today"
    if (/(hoje às|hoje|às) (\d{1,2}:\d{2}:\d{2}|\d{1,2}:\d{2}|\d{1,2})/.test(message)) {
      const timeMatch = message.match(/\d{1,2}(?::\d{2}(?::\d{2})?)?/);
      if (timeMatch) {
        const [hours, minutes = 0, seconds = 0] = timeMatch[0].split(":").map(Number);
        now.setHours(hours, minutes, seconds, 0);
        return now.toISOString();
      }
    }

    // "in x days"
    if (/(em|daqui|daqui a) \d+ dias/.test(message)) {
      const daysMatch = message.match(/em (\d+) dias/);
      if (daysMatch) {
        const days = parseInt(daysMatch[1], 10);
        now.setDate(now.getDate() + days);
        now.setHours(8, 0, 0, 0);
        return now.toISOString();
      }
    }

    // "in x minutes" or "in x hours"
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

  // "new task:" or variations
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

  // "remove" or "delete"
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

  // "clear tasks" or "clear events"
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

  // modification in tasks or events
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

  // detect patterns for events
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
        description: description || "Event without description",
        datetime,
        notify: 0,
      };
    }
  }

  // "query" or "show"
  if (["agenda", "tarefas", "eventos", "compromissos"].includes(lowerCaseMessage)) {
    return {
      type: "query",
      queryType: lowerCaseMessage === "tarefas" ? "tasks" : lowerCaseMessage === "eventos" ? "events" : "both",
    };
  }

  return null;
}
