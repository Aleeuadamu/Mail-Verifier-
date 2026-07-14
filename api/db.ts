import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from "fs";
import path from "path";

// Load config
const configPath = path.join(process.cwd(), "firebase-applet-config.json");
let config: any = {};
if (fs.existsSync(configPath)) {
  config = JSON.parse(fs.readFileSync(configPath, "utf8"));
}

const app = getApps().length === 0 ? initializeApp({
  credential: applicationDefault(),
  projectId: config.projectId,
}) : getApps()[0];

const db = getFirestore(app, config.firestoreDatabaseId || "ai-studio-mailverifier-dc1ff58a-9c34-4891-a598-e435ebb2f5a6");

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

export const dbService = {
  async getUserByEmail(email: string): Promise<User | null> {
    const normalizedEmail = email.toLowerCase().trim();
    const snapshot = await db.collection("users").where("email", "==", normalizedEmail).limit(1).get();
    if (snapshot.empty) return null;
    return snapshot.docs[0].data() as User;
  },

  async getUserById(id: string): Promise<User | null> {
    const doc = await db.collection("users").doc(id).get();
    if (!doc.exists) return null;
    return doc.data() as User;
  },

  async createUser(email: string, passwordHash: string, name: string): Promise<User> {
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
    await db.collection("users").doc(id).set(newUser);
    return newUser;
  },

  async updateUserSubscription(id: string, subscription: Partial<Subscription>): Promise<User | null> {
    const userRef = db.collection("users").doc(id);
    const doc = await userRef.get();
    if (!doc.exists) return null;
    
    const user = doc.data() as User;
    user.subscription = {
      ...user.subscription,
      ...subscription
    };
    await userRef.set(user);
    return user;
  },

  async saveGmailToken(id: string, token: string): Promise<void> {
    await db.collection("tokens").doc(id).set({ token });
  },

  async getGmailToken(id: string): Promise<string | null> {
    const doc = await db.collection("tokens").doc(id).get();
    if (!doc.exists) return null;
    return doc.data()?.token || null;
  },

  async getAllUsers(): Promise<User[]> {
    const snapshot = await db.collection("users").get();
    return snapshot.docs.map(doc => doc.data() as User);
  },

  async deleteUser(id: string): Promise<boolean> {
    const doc = await db.collection("users").doc(id).get();
    if (!doc.exists) return false;
    await db.collection("users").doc(id).delete();
    await db.collection("tokens").doc(id).delete();
    return true;
  }
};
