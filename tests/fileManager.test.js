import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { jest } from "@jest/globals";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { manageProcessPID, saveConfig, saveData, loadConfig, loadData, clearOldFiles } from "../modules/fileManager.js";

describe("fileManager module", () => {
  const dataDir = path.join(__dirname, "../data");
  const pidFilePath = path.join(dataDir, "pid.log");
  const configFilePath = path.join(dataDir, "config.json");
  const dataFilePath = path.join(dataDir, "data.json");

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("manageProcessPID", () => {
    test("should write pid when no PID file exists", () => {
      jest.spyOn(fs, "existsSync").mockReturnValue(false);
      const spyWrite = jest.spyOn(fs, "writeFileSync").mockImplementation(() => {});
      manageProcessPID(9999);
      expect(spyWrite).toHaveBeenCalledWith(pidFilePath, "9999", "utf8");
    });

    test("should kill old process and write new PID when PID file exists", () => {
      jest.spyOn(fs, "existsSync").mockReturnValue(true);
      jest.spyOn(fs, "readFileSync").mockReturnValue("1234");
      const spyKill = jest.spyOn(process, "kill").mockImplementation(() => {});
      const spyWrite = jest.spyOn(fs, "writeFileSync").mockImplementation(() => {});
      manageProcessPID(8888);
      expect(spyKill).toHaveBeenCalledWith(1234, "SIGTERM");
      expect(spyWrite).toHaveBeenCalledWith(pidFilePath, "8888", "utf8");
    });
  });

  describe("saveConfig and saveData", () => {
    test("should save config correctly", () => {
      const configStore = { key: "value" };
      const spyWrite = jest.spyOn(fs, "writeFileSync").mockImplementation(() => {});
      saveConfig(configStore);
      expect(spyWrite).toHaveBeenCalledWith(configFilePath, JSON.stringify(configStore, null, 2));
    });

    test("should save data correctly", () => {
      const dataStore = { foo: "bar" };
      const spyWrite = jest.spyOn(fs, "writeFileSync").mockImplementation(() => {});
      saveData(dataStore);
      expect(spyWrite).toHaveBeenCalledWith(dataFilePath, JSON.stringify(dataStore, null, 2));
    });
  });

  describe("loadConfig and loadData", () => {
    test("should create config file with default values if not exist", () => {
      jest.spyOn(fs, "existsSync").mockReturnValue(false);
      const configStore = { a: 1 };
      const spyWrite = jest.spyOn(fs, "writeFileSync").mockImplementation(() => {});
      loadConfig(configStore);
      expect(spyWrite).toHaveBeenCalledWith(configFilePath, JSON.stringify(configStore, null, 2));
    });

    test("should create data file with default values if not exist", () => {
      jest.spyOn(fs, "existsSync").mockReturnValue(false);
      const dataStore = { b: 2 };
      const spyWrite = jest.spyOn(fs, "writeFileSync").mockImplementation(() => {});
      loadData(dataStore);
      expect(spyWrite).toHaveBeenCalledWith(dataFilePath, JSON.stringify(dataStore, null, 2));
    });
  });

  describe("clearOldFiles", () => {
    test("should complete with no files to remove", async () => {
      const authDir = path.join(__dirname, "../auth");
      jest.spyOn(fs.promises, "readdir").mockResolvedValue([]);
      await expect(clearOldFiles()).resolves.toBeUndefined();
    });

    test("should attempt to clear old files", async () => {
      const authDir = path.join(__dirname, "../auth");
      const now = new Date();
      const oldTime = new Date(now);
      oldTime.setDate(oldTime.getDate() - 10);
      const recentTime = new Date(now);

      const oldFile = "oldSessionFile.txt";
      const recentFile = "recentFile.txt";
      const oldFilePath = path.join(authDir, oldFile);
      const recentFilePath = path.join(authDir, recentFile);

      jest.spyOn(fs.promises, "readdir").mockResolvedValue([oldFile, recentFile]);
      jest.spyOn(fs.promises, "stat").mockImplementation((filePath) => {
        if (filePath === oldFilePath) {
          return Promise.resolve({ mtime: oldTime });
        } else if (filePath === recentFilePath) {
          return Promise.resolve({ mtime: recentTime });
        }
        return Promise.resolve({ mtime: now });
      });
      const spyUnlink = jest.spyOn(fs.promises, "unlink").mockResolvedValue();
      await clearOldFiles();
      expect(spyUnlink).toHaveBeenCalledWith(oldFilePath);
      expect(spyUnlink).not.toHaveBeenCalledWith(recentFilePath);
    });
  });
});
