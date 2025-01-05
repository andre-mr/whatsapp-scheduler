import { ConsoleColors } from "./constants.js";

export function consoleLogColor(text, color = ConsoleColors.RESET, timestamp = true) {
  let formattedText = text;
  if (timestamp && text) {
    const now = new Date();
    const timestamp = now.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    formattedText = `[${timestamp}] ${text}`;
  }
  switch (color) {
    case ConsoleColors.RED:
      console.error(`${color}${formattedText}${ConsoleColors.RESET}`);
      break;
    case ConsoleColors.YELLOW:
      console.warn(`${color}${formattedText}${ConsoleColors.RESET}`);
      break;
    case ConsoleColors.CYAN:
    case ConsoleColors.GREEN:
      console.info(`${color}${formattedText}${ConsoleColors.RESET}`);
      break;
    default:
      console.log(`${color}${formattedText}${ConsoleColors.RESET}`);
      break;
  }
}

export async function fetchWhatsAppVersion() {
  const waVersionsUrl = "https://wppconnect.io/whatsapp-versions/";
  try {
    const response = await fetch(waVersionsUrl);
    const html = await response.text();

    const versionRegex = /href="https:\/\/web\.whatsapp\.com\/\?v=(\d+)\.(\d+)\.(\d+)-alpha"/;
    const match = html.match(versionRegex);

    if (match) {
      return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
    } else {
      throw new Error("WhatsApp version not found in the HTML");
    }
  } catch (error) {
    consoleLogColor("Erro ao verificar versão atual do WhatsApp!", ConsoleColors.RED);
    return [];
  }
}
