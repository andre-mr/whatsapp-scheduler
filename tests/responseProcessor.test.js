import { jest } from "@jest/globals";
import { processResponse } from "../modules/responseProcessor.js";

const mockTimezone = "America/Sao_Paulo";
const mockCurrentTime = new Date().toISOString();
const mockSenderJid = "553499991111@s.whatsapp.net";
const mockMessageSender = "553499991111@s.whatsapp.net";

let mockDataStore;
let mockHandleSendMessage;
let mockSaveData;

beforeEach(() => {
  mockDataStore = {
    [mockSenderJid]: {
      configs: {
        timezone: mockTimezone,
        listen: true,
        notify: true,
      },
      tasks: [],
      events: [],
    },
  };
  mockHandleSendMessage = jest.fn();
  mockSaveData = jest.fn();
});

describe("Event Response Processing", () => {
  test("should process event response correctly", async () => {
    const response = {
      type: "event",
      description: "Team Meeting",
      datetime: mockCurrentTime,
      notify: 15,
    };

    await processResponse(
      response,
      mockSenderJid,
      mockDataStore,
      mockHandleSendMessage,
      mockMessageSender,
      mockSaveData
    );

    expect(mockDataStore[mockSenderJid].events).toHaveLength(1);
    expect(mockDataStore[mockSenderJid].events[0]).toEqual({
      description: "Team Meeting",
      datetime: mockCurrentTime,
      notify: 15,
      sender: mockMessageSender,
    });
    expect(mockHandleSendMessage).toHaveBeenCalled();
    expect(mockSaveData).toHaveBeenCalledWith(mockDataStore);
  });
});

describe("Task Response Processing", () => {
  test("should process task response correctly", async () => {
    const response = {
      type: "task",
      description: "Buy groceries",
    };

    await processResponse(
      response,
      mockSenderJid,
      mockDataStore,
      mockHandleSendMessage,
      mockMessageSender,
      mockSaveData
    );

    expect(mockDataStore[mockSenderJid].tasks).toHaveLength(1);
    expect(mockDataStore[mockSenderJid].tasks[0]).toEqual({
      description: "Buy groceries",
      sender: mockMessageSender,
    });
    expect(mockHandleSendMessage).toHaveBeenCalled();
    expect(mockSaveData).toHaveBeenCalledWith(mockDataStore);
  });
});

describe("Update Response Processing", () => {
  beforeEach(() => {
    mockDataStore[mockSenderJid].tasks = [{ description: "Old task" }];
    mockDataStore[mockSenderJid].events = [{ description: "Old event", datetime: mockCurrentTime, notify: 0 }];
  });

  test("should update task description correctly", async () => {
    const response = {
      type: "update",
      target: "tasks",
      itemIndex: 0,
      fields: { description: "Updated task" },
    };

    await processResponse(
      response,
      mockSenderJid,
      mockDataStore,
      mockHandleSendMessage,
      mockMessageSender,
      mockSaveData
    );

    expect(mockDataStore[mockSenderJid].tasks[0].description).toBe("Updated task");
    expect(mockHandleSendMessage).toHaveBeenCalled();
    expect(mockSaveData).toHaveBeenCalledWith(mockDataStore);
  });

  test("should update event details correctly", async () => {
    const newDateTime = new Date(mockCurrentTime);
    newDateTime.setHours(newDateTime.getHours() + 1);

    const response = {
      type: "update",
      target: "events",
      itemIndex: 0,
      fields: {
        description: "Updated event",
        datetime: newDateTime.toISOString(),
        notify: 30,
      },
    };

    await processResponse(
      response,
      mockSenderJid,
      mockDataStore,
      mockHandleSendMessage,
      mockMessageSender,
      mockSaveData
    );

    expect(mockDataStore[mockSenderJid].events[0]).toEqual({
      description: "Updated event",
      datetime: newDateTime.toISOString(),
      notify: 30,
    });
    expect(mockHandleSendMessage).toHaveBeenCalled();
    expect(mockSaveData).toHaveBeenCalledWith(mockDataStore);
  });

  test("should handle invalid index for update", async () => {
    const response = {
      type: "update",
      target: "tasks",
      itemIndex: 999,
      fields: { description: "Invalid update" },
    };

    await processResponse(
      response,
      mockSenderJid,
      mockDataStore,
      mockHandleSendMessage,
      mockMessageSender,
      mockSaveData
    );

    expect(mockHandleSendMessage).toHaveBeenCalledWith(mockSenderJid, "❌ Índice inválido para atualização.");
    expect(mockSaveData).not.toHaveBeenCalled();
  });
});

describe("Remove Response Processing", () => {
  beforeEach(() => {
    mockDataStore[mockSenderJid].tasks = [{ description: "Task to remove" }];
    mockDataStore[mockSenderJid].events = [{ description: "Event to remove", datetime: mockCurrentTime }];
  });

  test("should remove task correctly", async () => {
    const response = {
      type: "remove",
      target: "tasks",
      itemIndex: 0,
    };

    await processResponse(
      response,
      mockSenderJid,
      mockDataStore,
      mockHandleSendMessage,
      mockMessageSender,
      mockSaveData
    );

    expect(mockDataStore[mockSenderJid].tasks).toHaveLength(0);
    expect(mockHandleSendMessage).toHaveBeenCalled();
    expect(mockSaveData).toHaveBeenCalledWith(mockDataStore);
  });

  test("should handle invalid index for removal", async () => {
    const response = {
      type: "remove",
      target: "tasks",
      itemIndex: 999,
    };

    await processResponse(
      response,
      mockSenderJid,
      mockDataStore,
      mockHandleSendMessage,
      mockMessageSender,
      mockSaveData
    );

    expect(mockHandleSendMessage).toHaveBeenCalledWith(mockSenderJid, "❌ Falha na remoção.");
    expect(mockSaveData).not.toHaveBeenCalled();
  });
});

describe("Clear Response Processing", () => {
  beforeEach(() => {
    mockDataStore[mockSenderJid].tasks = [{ description: "Task 1" }, { description: "Task 2" }];
    mockDataStore[mockSenderJid].events = [
      { description: "Event 1", datetime: mockCurrentTime },
      { description: "Event 2", datetime: mockCurrentTime },
    ];
  });

  test("should clear all tasks", async () => {
    const response = {
      type: "clear",
      target: "tasks",
    };

    await processResponse(
      response,
      mockSenderJid,
      mockDataStore,
      mockHandleSendMessage,
      mockMessageSender,
      mockSaveData
    );

    expect(mockDataStore[mockSenderJid].tasks).toHaveLength(0);
    expect(mockDataStore[mockSenderJid].events).toHaveLength(2);
    expect(mockHandleSendMessage).toHaveBeenCalled();
    expect(mockSaveData).toHaveBeenCalledWith(mockDataStore);
  });

  test("should clear all events", async () => {
    const response = {
      type: "clear",
      target: "events",
    };

    await processResponse(
      response,
      mockSenderJid,
      mockDataStore,
      mockHandleSendMessage,
      mockMessageSender,
      mockSaveData
    );

    expect(mockDataStore[mockSenderJid].events).toHaveLength(0);
    expect(mockDataStore[mockSenderJid].tasks).toHaveLength(2);
    expect(mockHandleSendMessage).toHaveBeenCalled();
    expect(mockSaveData).toHaveBeenCalledWith(mockDataStore);
  });

  test("should clear everything", async () => {
    const response = {
      type: "clear",
      target: "all",
    };

    await processResponse(
      response,
      mockSenderJid,
      mockDataStore,
      mockHandleSendMessage,
      mockMessageSender,
      mockSaveData
    );

    expect(mockDataStore[mockSenderJid].tasks).toHaveLength(0);
    expect(mockDataStore[mockSenderJid].events).toHaveLength(0);
    expect(mockHandleSendMessage).toHaveBeenCalled();
    expect(mockSaveData).toHaveBeenCalledWith(mockDataStore);
  });
});

describe("Query Response Processing", () => {
  beforeEach(() => {
    mockDataStore[mockSenderJid].tasks = [{ description: "Task 1" }];
    mockDataStore[mockSenderJid].events = [{ description: "Event 1", datetime: mockCurrentTime, notify: 15 }];
  });

  test("should return formatted list of tasks and events", async () => {
    const response = {
      type: "query",
      queryType: "both",
    };

    await processResponse(
      response,
      mockSenderJid,
      mockDataStore,
      mockHandleSendMessage,
      mockMessageSender,
      mockSaveData
    );

    expect(mockHandleSendMessage).toHaveBeenCalled();
    const call = mockHandleSendMessage.mock.calls[0];
    expect(call[0]).toBe(mockSenderJid);
    expect(call[1]).toContain("📋 Tarefas:");
    expect(call[1]).toContain("📅 Eventos:");
  });

  test("should handle empty lists", async () => {
    mockDataStore[mockSenderJid].tasks = [];
    mockDataStore[mockSenderJid].events = [];

    const response = {
      type: "query",
      queryType: "both",
    };

    await processResponse(
      response,
      mockSenderJid,
      mockDataStore,
      mockHandleSendMessage,
      mockMessageSender,
      mockSaveData
    );

    expect(mockHandleSendMessage).toHaveBeenCalledWith(mockSenderJid, "Nenhum item encontrado.");
  });
});

describe("Invalid Response Processing", () => {
  test("should handle unknown response type", async () => {
    const response = {
      type: "unknown",
    };

    await processResponse(
      response,
      mockSenderJid,
      mockDataStore,
      mockHandleSendMessage,
      mockMessageSender,
      mockSaveData
    );

    expect(mockHandleSendMessage).toHaveBeenCalledWith(
      mockSenderJid,
      "Não entendi sua solicitação. Reformule, por favor."
    );
    expect(mockSaveData).not.toHaveBeenCalled();
  });
});
