import fs from "fs";
import path from "path";

const DB_FILE = path.join(process.cwd(), "db.json");

export interface Subscription {
  plan: string;
  usage: number;
  paymentMethod: string;
  currentPeriodEnd: string | null;
  trialStartDate: string | null;
  invoices: Array<{ id: string; date: string; amount: string; status: "paid" | "pending" }>;
}

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  subscription: Subscription;
  createdAt: string;
}

interface DatabaseSchema {
  users: Record<string, User>;
  tokens: Record<string, string>;
}

// Ensure db file exists and is valid
function initDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const initialData: DatabaseSchema = { users: {}, tokens: {} };
      fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2), "utf8");
    } else {
      // Validate structure
      const content = fs.readFileSync(DB_FILE, "utf8");
      JSON.parse(content);
    }
  } catch (error) {
    console.error("Failed to initialize db.json, creating a new one", error);
    const initialData: DatabaseSchema = { users: {}, tokens: {} };
    fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2), "utf8");
  }
}

initDb();

function readDb(): DatabaseSchema {
  try {
    const content = fs.readFileSync(DB_FILE, "utf8");
    return JSON.parse(content);
  } catch (error) {
    console.error("Error reading db.json", error);
    return { users: {}, tokens: {} };
  }
}

function writeDb(data: DatabaseSchema) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (error) {
    console.error("Error writing to db.json", error);
  }
}

export const dbService = {
  getUserByEmail(email: string): User | null {
    const db = readDb();
    const normalizedEmail = email.toLowerCase().trim();
    for (const user of Object.values(db.users)) {
      if (user.email.toLowerCase().trim() === normalizedEmail) {
        return user;
      }
    }
    return null;
  },

  getUserById(id: string): User | null {
    const db = readDb();
    return db.users[id] || null;
  },

  createUser(email: string, passwordHash: string, name: string): User {
    const db = readDb();
    const id = "usr_" + Math.random().toString(36).substring(2, 11);
    
    const newUser: User = {
      id,
      email: email.toLowerCase().trim(),
      passwordHash,
      name: name.trim(),
      subscription: {
        plan: "free",
        usage: 0,
        paymentMethod: "None",
        currentPeriodEnd: null,
        trialStartDate: new Date().toISOString(),
        invoices: []
      },
      createdAt: new Date().toISOString()
    };

    db.users[id] = newUser;
    writeDb(db);
    return newUser;
  },

  updateUserSubscription(id: string, subscription: Partial<Subscription>): User | null {
    const db = readDb();
    const user = db.users[id];
    if (!user) return null;

    user.subscription = {
      ...user.subscription,
      ...subscription
    };

    db.users[id] = user;
    writeDb(db);
    return user;
  },

  saveGmailToken(id: string, token: string) {
    const db = readDb();
    db.tokens[id] = token;
    writeDb(db);
  },

  getGmailToken(id: string): string | null {
    const db = readDb();
    return db.tokens[id] || null;
  },

  getAllUsers(): User[] {
    const db = readDb();
    return Object.values(db.users);
  },

  deleteUser(id: string): boolean {
    const db = readDb();
    if (!db.users[id]) return false;
    delete db.users[id];
    delete db.tokens[id]; // clean up token as well
    writeDb(db);
    return true;
  }
};
