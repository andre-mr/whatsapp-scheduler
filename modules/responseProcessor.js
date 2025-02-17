export async function processResponse(response, senderJid, dataStore, handleSendMessage, messageSender, saveData) {
    if (response.type === "event") {
        const notify = response.notify !== undefined ? response.notify : 0;
        dataStore[senderJid].events.push({
            description: response.description,
            datetime: response.datetime,
            notify,
            sender: messageSender,
        });

        saveData(dataStore);

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
        saveData(dataStore);
        await handleSendMessage(senderJid, `✅ Tarefa "${response.description}" adicionada.`);
    } else if (response.type === "update") {
        const targetList = response.target === "tasks" ? dataStore[senderJid].tasks : dataStore[senderJid].events;
        if (response.itemIndex < 0 || response.itemIndex >= targetList.length) {
            await handleSendMessage(senderJid, "❌ Índice inválido para atualização.");
            return;
        }

        const itemToUpdate = targetList[response.itemIndex];

        if (!itemToUpdate) {
            await handleSendMessage(senderJid, `❌ Não foi possível encontrar o item para atualização.`);
            return;
        }

        if (response.fields?.datetime) {
            targetList[response.itemIndex].datetime = response.fields.datetime;
        }
        if (response.fields?.description) {
            targetList[response.itemIndex].description = response.fields.description;
        }
        if (response.fields?.notify !== undefined) {
            targetList[response.itemIndex].notify = response.fields.notify;
        }

        saveData(dataStore);

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
            return;
        }

        if (response.itemIndex >= 0) {
            const removedItem = targetList.splice(response.itemIndex, 1)?.[0];
            saveData(dataStore);

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
        saveData(dataStore);

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
