import OpenAI from "openai";
import { consoleLogColor } from "./utils.js";
import { ConsoleColors } from "./constants.js";
import dotenv from "dotenv";

dotenv.config(); // Load environment variables from .env file

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function processOpenAIQuery(messageContent, currentDateTimeISO, senderJid, dataStore) {
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
          - **Fuso horário:** ${dataStore[senderJid].configs.timezone}
          - **Data/hora atual em ISOstring:** ${currentDateTimeISO}
          - **Tarefas existentes:** ${JSON.stringify(dataStore[senderJid].tasks, null, 2)}
          - **Eventos existentes:** ${JSON.stringify(dataStore[senderJid].events, null, 2)}
          - **Mensagem:** "${messageContent}"`,
        },
      ],
    });

    const content = openaiResponse.choices[0].message.content.trim();
    consoleLogColor(`Resposta da OpenAI: ${content}`, ConsoleColors.RESET);

    // Check if the response is JSON
    const jsonMatch = content.match(/{[\s\S]*}/);
    if (jsonMatch) {
      const response = JSON.parse(jsonMatch[0]);
      consoleLogColor("JSON processado com sucesso.", ConsoleColors.GREEN);
      return response;
    } else {
      // Return the textual response as is
      return { type: "text", content };
    }
  } catch (error) {
    console.error("Erro ao processar JSON da OpenAI:", error);
    throw error;
  }
}
