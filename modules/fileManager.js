import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// New data directory set one level up from modules folder
const dataDir = path.join(__dirname, "../data");

// Manage PID to avoid duplicate processes
export function manageProcessPID(processPid = process.pid) {
  const pidFilePath = path.join(dataDir, "pid.log");
  try {
    if (fs.existsSync(pidFilePath)) {
      const pidContent = fs.readFileSync(pidFilePath, "utf8").trim();
      if (pidContent && !isNaN(pidContent)) {
        const oldPID = parseInt(pidContent, 10);
        try {
          process.kill(oldPID, "SIGTERM");
          console.log(`Processo anterior (PID: ${oldPID}) encerrado.`);
        } catch {
          console.log(`Processo anterior não encontrado (PID: ${oldPID}).`);
        }
      }
    }
    fs.writeFileSync(pidFilePath, processPid.toString(), "utf8");
  } catch (err) {
    console.error("Erro ao gerenciar o PID: " + err);
  }
}

// Define file paths relative to the data folder
const configFilePath = path.join(dataDir, "config.json");
const dataFilePath = path.join(dataDir, "data.json");

export function saveConfig(configStore) {
  fs.writeFileSync(configFilePath, JSON.stringify(configStore, null, 2));
}

export function saveData(dataStore) {
  fs.writeFileSync(dataFilePath, JSON.stringify(dataStore, null, 2));
}

export function loadConfig(configStore) {
  if (fs.existsSync(configFilePath)) {
    try {
      const rawConfig = fs.readFileSync(configFilePath, "utf8");
      const loadedConfig = JSON.parse(rawConfig);
      Object.keys(configStore).forEach((key) => {
        if (!(key in loadedConfig)) {
          loadedConfig[key] = configStore[key];
        }
      });
      Object.assign(configStore, loadedConfig);
      saveConfig(configStore);
    } catch (error) {
      console.error("Erro ao carregar config.json. Recriando com valores padrão.");
      fs.writeFileSync(configFilePath, JSON.stringify(configStore, null, 2));
    }
  } else {
    fs.writeFileSync(configFilePath, JSON.stringify(configStore, null, 2));
    console.log("Arquivo config.json criado com valores padrão.");
  }
}

export function loadData(dataStore) {
  if (fs.existsSync(dataFilePath)) {
    try {
      const rawData = fs.readFileSync(dataFilePath, "utf8");
      const loadedData = JSON.parse(rawData);
      Object.keys(dataStore).forEach((key) => {
        if (!(key in loadedData)) {
          loadedData[key] = dataStore[key];
        }
      });
      Object.assign(dataStore, loadedData);
      saveData(dataStore);
    } catch (error) {
      console.error("Erro ao carregar data.json. Recriando com valores padrão.");
      fs.writeFileSync(dataFilePath, JSON.stringify(dataStore, null, 2));
    }
  } else {
    fs.writeFileSync(dataFilePath, JSON.stringify(dataStore, null, 2));
    console.log("Arquivo data.json criado com valores padrão.");
  }
}

export async function clearOldFiles() {
  const authDir = path.join(__dirname, "../auth");
  const retentionDays = 3;
  try {
    const files = await fs.promises.readdir(authDir);
    if (files.length === 0) return;
    const filesStats = await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(authDir, file);
        const fileStat = await fs.promises.stat(filePath);
        return { path: filePath, mtime: fileStat.mtime };
      })
    );
    const mostRecentFile = filesStats.reduce((latest, current) => (current.mtime > latest.mtime ? current : latest));
    const retentionLimit = new Date(mostRecentFile.mtime);
    retentionLimit.setDate(retentionLimit.getDate() - retentionDays);
    const filesToRemove = filesStats.filter((file) => file.mtime < retentionLimit);
    for (const file of filesToRemove) {
      await fs.promises.unlink(file.path);
    }
    if (filesToRemove.length > 0) {
      console.log(`Cleared ${filesToRemove.length} old session files.`);
    }
  } catch (error) {
    console.error("Error clearing old files:", error);
  }
}
