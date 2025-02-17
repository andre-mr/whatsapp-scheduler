import { jest } from "@jest/globals";
import { evaluateMessage } from "../modules/messageEvaluator.js";

const mockSenderJid = "553499991111@s.whatsapp.net";
const mockTimezone = "America/Sao_Paulo";
let mockDataStore = {};
let defaultUserData = {};

describe("evaluateMessage - Add User Command", () => {
  let mockHandleSendMessage;
  let mockSaveData;

  beforeEach(() => {
    defaultUserData = {
      configs: {
        expiration: 0,
        listen: true,
        notify: true,
        timezone: "America/Sao_Paulo",
      },
      events: [],
      tasks: [],
    };
    mockDataStore = {
      [mockSenderJid]: {
        configs: {
          expiration: 0,
          listen: true,
          notify: true,
          timezone: mockTimezone,
        },
        events: [],
        tasks: [],
      },
    };
    mockHandleSendMessage = jest.fn();
    mockSaveData = jest.fn();
  });

  test("should add new user when admin sends valid command", async () => {
    const messageProcessed = "adicionar usuario @553499992222";
    const senderJid = "553499991111@s.whatsapp.net";
    const params = {
      isAdmin: true,
      dataStore: mockDataStore,
      defaultUserData,
      senderJid,
      handleSendMessage: mockHandleSendMessage,
      saveData: mockSaveData,
      isAuthorized: true,
    };

    const result = await evaluateMessage(messageProcessed, params);

    expect(result).toBe(true);
    expect(mockDataStore["553499991111@s.whatsapp.net"]).toEqual(defaultUserData);
    expect(mockHandleSendMessage).toHaveBeenCalledWith(senderJid, "✅ Usuário adicionado.");
    expect(mockSaveData).toHaveBeenCalledWith(mockDataStore);
  });

  test("should handle already authorized user", async () => {
    const messageProcessed = "adicionar @553499991111";
    const senderJid = "admin@s.whatsapp.net";
    mockDataStore["553499991111@s.whatsapp.net"] = defaultUserData;

    const params = {
      isAdmin: true,
      dataStore: mockDataStore,
      senderJid,
      handleSendMessage: mockHandleSendMessage,
      saveData: mockSaveData,
      isAuthorized: true,
    };

    const result = await evaluateMessage(messageProcessed, params);

    expect(result).toBe(true);
    expect(mockHandleSendMessage).toHaveBeenCalledWith(senderJid, "❌ Usuário já está autorizado.");
    expect(mockSaveData).not.toHaveBeenCalled();
  });

  test("should ignore command when sender is not admin", async () => {
    const messageProcessed = "adicionar usuario @553499992222";
    const senderJid = "553499990000@s.whatsapp.net";

    const params = {
      isAdmin: false,
      dataStore: mockDataStore,
      senderJid,
      handleSendMessage: mockHandleSendMessage,
      saveData: mockSaveData,
      isAuthorized: true,
    };

    const result = await evaluateMessage(messageProcessed, params);

    expect(result).toBe(false); // Changed from true to false
    expect(mockDataStore[senderJid]).toBeUndefined();
    expect(mockHandleSendMessage).not.toHaveBeenCalled();
    expect(mockSaveData).not.toHaveBeenCalled();
  });

  test("should match different variations of add user command", async () => {
    const variations = [
      "adicionar @553499992222",
      "adicionar usuario @553499992222",
      "adicionar usuário @553499992222",
    ];

    const senderJid = "admin@s.whatsapp.net";
    const params = {
      isAdmin: true,
      dataStore: mockDataStore,
      senderJid,
      handleSendMessage: mockHandleSendMessage,
      saveData: mockSaveData,
      isAuthorized: true,
    };

    for (const command of variations) {
      // mockDataStore = {};
      mockHandleSendMessage.mockClear();
      mockSaveData.mockClear();

      const result = await evaluateMessage(command, params);

      expect(result).toBe(true);
      expect(mockDataStore["553499991111@s.whatsapp.net"]).toEqual(defaultUserData);
      expect(mockHandleSendMessage).toHaveBeenCalledWith(senderJid, "✅ Usuário adicionado.");
      expect(mockSaveData).toHaveBeenCalledWith(mockDataStore);
    }
  });

  test("should not match invalid phone number formats", async () => {
    const invalidCommands = [
      "adicionar usuario @123", // too short
      "adicionar @5550349999911111", // too long
      "adicionar usuario 553499991111", // missing @
      "adicionar usuario @abc12345678901", // invalid characters
    ];

    const senderJid = "admin@s.whatsapp.net";
    const originalDataStore = structuredClone(mockDataStore);
    const params = {
      isAdmin: true,
      dataStore: mockDataStore,
      defaultUserData,
      senderJid,
      handleSendMessage: mockHandleSendMessage,
      saveData: mockSaveData,
      isAuthorized: true,
    };

    for (const command of invalidCommands) {
      const result = await evaluateMessage(command, params);

      console.log("result:", result);
      console.log("originalDataStore:", originalDataStore);
      console.log("mockDataStore:", mockDataStore);
      expect(result).toBe(false); // Should not match the command regex
      expect(mockDataStore).toEqual(originalDataStore); // Should not modify dataStore
      expect(mockHandleSendMessage).not.toHaveBeenCalled();
      expect(mockSaveData).not.toHaveBeenCalled();
    }
  });
});
