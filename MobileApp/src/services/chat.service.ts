import {
  collection,
  doc,
  addDoc,
  serverTimestamp,
  query,
  orderBy,
  onSnapshot,
  setDoc,
} from 'firebase/firestore';
import { firestore } from '../config/firebase';
import { ChatMessage } from '../types';

const THREADS_COLLECTION = 'chat_threads';
const MESSAGES_SUBCOLLECTION = 'messages';

const buildThreadId = (caregiverId: number, patientId: number) =>
  `care_${caregiverId}_patient_${patientId}`;

class ChatService {
  async ensureThread(caregiverId: number, patientId: number, caregiverName?: string, patientName?: string) {
    const threadId = buildThreadId(caregiverId, patientId);
    const threadRef = doc(firestore, THREADS_COLLECTION, threadId);
    await setDoc(
      threadRef,
      {
        caregiverId,
        patientId,
        caregiverName: caregiverName || '',
        patientName: patientName || '',
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    return threadId;
  }

  listenMessages(
    threadId: string,
    onUpdate: (messages: ChatMessage[]) => void
  ) {
    const messagesRef = collection(firestore, THREADS_COLLECTION, threadId, MESSAGES_SUBCOLLECTION);
    const messagesQuery = query(messagesRef, orderBy('createdAt', 'asc'));

    return onSnapshot(messagesQuery, (snapshot) => {
      const items: ChatMessage[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          text: data.text || '',
          senderId: data.senderId,
          senderName: data.senderName,
          createdAt: data.createdAt?.toDate?.().toISOString?.() || new Date().toISOString(),
        };
      });
      onUpdate(items);
    });
  }

  async sendMessage(
    threadId: string,
    message: Omit<ChatMessage, 'id' | 'createdAt'>
  ) {
    const messagesRef = collection(firestore, THREADS_COLLECTION, threadId, MESSAGES_SUBCOLLECTION);
    await addDoc(messagesRef, {
      text: message.text,
      senderId: message.senderId,
      senderName: message.senderName || '',
      createdAt: serverTimestamp(),
    });
  }
}

export const chatService = new ChatService();
