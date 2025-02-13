import { interpretMessage } from '../modules/messageInterpreter.js';

const mockTimezone = "America/Sao_Paulo";
const mockCurrentTime = new Date().toISOString();
const mockSenderJid = "553499991111@s.whatsapp.net";

const mockDataStore = {
    [mockSenderJid]: {
        configs: {
            timezone: mockTimezone,
            listen: true,
            notify: true
        },
        tasks: [],
        events: []
    }
};

beforeEach(() => {
    mockDataStore[mockSenderJid].tasks = [];
    mockDataStore[mockSenderJid].events = [];
});

describe('Task Creation', () => {
    test('should interpret "nova tarefa:" command correctly', () => {
        const message = "nova tarefa: Comprar café";
        const result = interpretMessage(message, mockCurrentTime, mockSenderJid, mockDataStore);

        expect(result).toEqual({
            type: "task",
            description: "Comprar café"
        });
    });

    test('should interpret "tarefa:" command correctly', () => {
        const message = "tarefa: Ligar para o cliente";
        const result = interpretMessage(message, mockCurrentTime, mockSenderJid, mockDataStore);

        expect(result).toEqual({
            type: "task",
            description: "Ligar para o cliente"
        });
    });
});

describe('Event Creation', () => {
    test('should interpret event with absolute with only time correctly', () => {
        const message = "Reunião com equipe às 15:00";
        const result = interpretMessage(message, mockCurrentTime, mockSenderJid, mockDataStore);

        expect(result).toEqual({
            type: "event",
            description: "Reunião com equipe",
            datetime: expect.any(String),
            notify: 0
        });

        // Verify the complete datetime
        const eventDate = new Date(result.datetime);
        const currentDate = new Date(mockCurrentTime);

        expect(eventDate.getFullYear()).toBe(currentDate.getFullYear());
        expect(eventDate.getMonth()).toBe(currentDate.getMonth());
        expect(eventDate.getDate()).toBe(currentDate.getDate());
        expect(eventDate.getHours()).toBe(15);
        expect(eventDate.getMinutes()).toBe(0);
    });

    test('should interpret event with absolute today time correctly', () => {
        const message = "Reunião com equipe hoje às 15:00";
        const result = interpretMessage(message, mockCurrentTime, mockSenderJid, mockDataStore);

        expect(result).toEqual({
            type: "event",
            description: "Reunião com equipe",
            datetime: expect.any(String),
            notify: 0
        });

        // Verify the complete datetime
        const eventDate = new Date(result.datetime);
        const currentDate = new Date(mockCurrentTime);

        expect(eventDate.getFullYear()).toBe(currentDate.getFullYear());
        expect(eventDate.getMonth()).toBe(currentDate.getMonth());
        expect(eventDate.getDate()).toBe(currentDate.getDate());
        expect(eventDate.getHours()).toBe(15);
        expect(eventDate.getMinutes()).toBe(0);
    });

    test('should interpret event with absolute tomorrow time correctly', () => {
        const message = "Reunião com equipe amanhã às 15:00";
        const result = interpretMessage(message, mockCurrentTime, mockSenderJid, mockDataStore);

        expect(result).toEqual({
            type: "event",
            description: "Reunião com equipe",
            datetime: expect.any(String),
            notify: 0
        });

        // Verify the complete datetime
        const eventDate = new Date(result.datetime);
        const expectedDate = new Date(mockCurrentTime);
        expectedDate.setDate(expectedDate.getDate() + 1); // Add one day

        expect(eventDate.getFullYear()).toBe(expectedDate.getFullYear());
        expect(eventDate.getMonth()).toBe(expectedDate.getMonth());
        expect(eventDate.getDate()).toBe(expectedDate.getDate());
        expect(eventDate.getHours()).toBe(15);
        expect(eventDate.getMinutes()).toBe(0);
    });

    test('should interpret event with absolute datetime correctly', () => {
        const futureTime = new Date(mockCurrentTime);
        futureTime.setDate(futureTime.getDate() + 10);
        const message = `Reunião com equipe dia ${futureTime.toLocaleDateString('pt-BR')} às 15:00`;
        const result = interpretMessage(message, mockCurrentTime, mockSenderJid, mockDataStore);

        expect(result).toEqual({
            type: "event",
            description: "Reunião com equipe",
            datetime: expect.any(String),
            notify: 0
        });

        // Verify the complete datetime
        const eventDate = new Date(result.datetime);
        const expectedDate = futureTime;

        expect(eventDate.getFullYear()).toBe(expectedDate.getFullYear());
        expect(eventDate.getMonth()).toBe(expectedDate.getMonth());
        expect(eventDate.getDate()).toBe(expectedDate.getDate());
        expect(eventDate.getHours()).toBe(15);
        expect(eventDate.getMinutes()).toBe(0);
    });

    test('should interpret event with "evento:" prefix correctly and parse today date', () => {
        const message = "evento: Team Meeting hoje às 09:30";
        const result = interpretMessage(message, mockCurrentTime, mockSenderJid, mockDataStore);

        expect(result).toEqual({
            type: "event",
            description: "Team Meeting",
            datetime: expect.any(String),
            notify: 0
        });

        const eventDate = new Date(result.datetime);
        const currentDate = new Date(mockCurrentTime);

        expect(eventDate.getFullYear()).toBe(currentDate.getFullYear());
        expect(eventDate.getMonth()).toBe(currentDate.getMonth());
        expect(eventDate.getDate()).toBe(currentDate.getDate());
        expect(eventDate.getHours()).toBe(9);
        expect(eventDate.getMinutes()).toBe(30);
    });

    test('should interpret event with "adicionar evento:" prefix correctly and parse tomorrow date', () => {
        const message = "adicionar evento: Project Kickoff amanhã às 10:00";
        const result = interpretMessage(message, mockCurrentTime, mockSenderJid, mockDataStore);

        expect(result).toEqual({
            type: "event",
            description: "Project Kickoff",
            datetime: expect.any(String),
            notify: 0
        });

        const eventDate = new Date(result.datetime);
        const expectedDate = new Date(mockCurrentTime);
        expectedDate.setDate(expectedDate.getDate() + 1);

        expect(eventDate.getFullYear()).toBe(expectedDate.getFullYear());
        expect(eventDate.getMonth()).toBe(expectedDate.getMonth());
        expect(eventDate.getDate()).toBe(expectedDate.getDate());
        expect(eventDate.getHours()).toBe(10);
        expect(eventDate.getMinutes()).toBe(0);
    });
});

describe('Remove Commands', () => {
    beforeEach(() => {
        // Set up some sample tasks and events
        mockDataStore[mockSenderJid].tasks = [
            { description: "Comprar café" },
            { description: "Ligar para cliente" }
        ];
        mockDataStore[mockSenderJid].events = [
            { description: "Reunião importante", datetime: mockCurrentTime },
            { description: "Almoço com equipe", datetime: mockCurrentTime }
        ];
    });

    test('should interpret remove event command correctly', () => {
        const message = "remover Reunião importante";
        const result = interpretMessage(message, mockCurrentTime, mockSenderJid, mockDataStore);

        expect(result).toEqual({
            type: "remove",
            target: "events",
            itemIndex: 0
        });
    });

    test('should interpret apagar event command correctly', () => {
        const message = "apagar Almoço com equipe";
        const result = interpretMessage(message, mockCurrentTime, mockSenderJid, mockDataStore);

        expect(result).toEqual({
            type: "remove",
            target: "events",
            itemIndex: 1
        });
    });

    test('should interpret excluir event command correctly', () => {
        const message = "excluir Reunião importante";
        const result = interpretMessage(message, mockCurrentTime, mockSenderJid, mockDataStore);

        expect(result).toEqual({
            type: "remove",
            target: "events",
            itemIndex: 0
        });
    });

    test('should return null for non-existent event', () => {
        const message = "remover Evento que não existe";
        const result = interpretMessage(message, mockCurrentTime, mockSenderJid, mockDataStore);

        expect(result).toBe(null);
    });
});

describe('Clear Commands', () => {
    beforeEach(() => {
        // Set up some sample tasks and events
        mockDataStore[mockSenderJid].tasks = [
            { description: "Comprar café" },
            { description: "Ligar para cliente" }
        ];
        mockDataStore[mockSenderJid].events = [
            { description: "Reunião importante", datetime: mockCurrentTime },
            { description: "Almoço com equipe", datetime: mockCurrentTime }
        ];
    });

    test('should interpret clear tasks command correctly', () => {
        const message = "limpar tarefas";
        const result = interpretMessage(message, mockCurrentTime, mockSenderJid, mockDataStore);

        expect(result).toEqual({
            type: "clear",
            target: "tasks"
        });
    });

    test('should interpret clear events command correctly', () => {
        const message = "limpar eventos";
        const result = interpretMessage(message, mockCurrentTime, mockSenderJid, mockDataStore);

        expect(result).toEqual({
            type: "clear",
            target: "events"
        });
    });

    test('should interpret clear all command correctly', () => {
        const message = "limpar tudo";
        const result = interpretMessage(message, mockCurrentTime, mockSenderJid, mockDataStore);

        expect(result).toEqual({
            type: "clear",
            target: "all"
        });
    });
});

describe('Change Commands', () => {
    beforeEach(() => {
        mockDataStore[mockSenderJid].tasks = [
            { description: "Comprar café" },
            { description: "Ligar para cliente" }
        ];
        mockDataStore[mockSenderJid].events = [
            { description: "Reunião importante", datetime: mockCurrentTime },
            { description: "Almoço com equipe", datetime: mockCurrentTime }
        ];
    });

    test('should interpret task description change correctly', () => {
        const message = "mudar Comprar café para Comprar chá";
        const result = interpretMessage(message, mockCurrentTime, mockSenderJid, mockDataStore);

        expect(result).toEqual({
            type: "update",
            target: "tasks",
            itemIndex: 0,
            fields: { description: "Comprar chá" }
        });
    });

    test('should interpret event description change correctly', () => {
        const message = "mudar Reunião importante para Reunião com diretoria";
        const result = interpretMessage(message, mockCurrentTime, mockSenderJid, mockDataStore);

        expect(result).toEqual({
            type: "update",
            target: "events",
            itemIndex: 0,
            fields: { description: "Reunião com diretoria" }
        });
    });

    test('should interpret event time change correctly', () => {
        const message = "mudar Reunião importante para hoje às 15:00";
        const result = interpretMessage(message, mockCurrentTime, mockSenderJid, mockDataStore);

        expect(result).toEqual({
            type: "update",
            target: "events",
            itemIndex: 0,
            fields: { datetime: expect.any(String) }
        });

        const eventDate = new Date(result.fields.datetime);
        const currentDate = new Date(mockCurrentTime);

        expect(eventDate.getFullYear()).toBe(currentDate.getFullYear());
        expect(eventDate.getMonth()).toBe(currentDate.getMonth());
        expect(eventDate.getDate()).toBe(currentDate.getDate());
        expect(eventDate.getHours()).toBe(15);
        expect(eventDate.getMinutes()).toBe(0);
    });

    test('should return null for non-existent item change', () => {
        const message = "mudar Item inexistente para Novo item";
        const result = interpretMessage(message, mockCurrentTime, mockSenderJid, mockDataStore);

        expect(result).toBe(null);
    });
});

describe('Query Commands', () => {
    test('should interpret "agenda" command correctly', () => {
        const message = "agenda";
        const result = interpretMessage(message, mockCurrentTime, mockSenderJid, mockDataStore);

        expect(result).toEqual({
            type: "query",
            queryType: "both"
        });
    });

    test('should interpret "tarefas" command correctly', () => {
        const message = "tarefas";
        const result = interpretMessage(message, mockCurrentTime, mockSenderJid, mockDataStore);

        expect(result).toEqual({
            type: "query",
            queryType: "tasks"
        });
    });

    test('should interpret "eventos" command correctly', () => {
        const message = "eventos";
        const result = interpretMessage(message, mockCurrentTime, mockSenderJid, mockDataStore);

        expect(result).toEqual({
            type: "query",
            queryType: "events"
        });
    });

    test('should interpret "compromissos" command correctly', () => {
        const message = "compromissos";
        const result = interpretMessage(message, mockCurrentTime, mockSenderJid, mockDataStore);

        expect(result).toEqual({
            type: "query",
            queryType: "both"
        });
    });
});