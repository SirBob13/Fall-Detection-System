import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useLanguage } from '../components/LanguageProvider';
import { authService } from '../services/auth.service';
import { chatService } from '../services/chat.service';
import { ChatMessage } from '../types';

type RouteParams = {
  patientId: number;
  patientName?: string;
};

export const ChatScreen: React.FC = () => {
  const { t } = useLanguage();
  const route = useRoute();
  const navigation = useNavigation<any>();
  const { patientId, patientName } = route.params as RouteParams;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [threadId, setThreadId] = useState<string>('');
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [currentUserName, setCurrentUserName] = useState<string>('');

  useEffect(() => {
    const init = async () => {
      const user = await authService.getCurrentUser();
      const caregiverId = user?.id ? Number(user.id) : 0;
      const caregiverName = user?.name || '';
      setCurrentUserId(caregiverId);
      setCurrentUserName(caregiverName);

      const id = await chatService.ensureThread(
        caregiverId,
        patientId,
        caregiverName,
        patientName
      );
      setThreadId(id);
    };
    init();
  }, [patientId, patientName]);

  useEffect(() => {
    if (!threadId) return;
    const unsubscribe = chatService.listenMessages(threadId, setMessages);
    return () => unsubscribe();
  }, [threadId]);

  const canSend = useMemo(() => input.trim().length > 0 && threadId && currentUserId, [
    input,
    threadId,
    currentUserId,
  ]);

  const handleSend = async () => {
    if (!canSend || currentUserId === null) return;
    const text = input.trim();
    setInput('');
    await chatService.sendMessage(threadId, {
      text,
      senderId: currentUserId,
      senderName: currentUserName,
    });
  };

  const handleStartCall = () => {
    if (!threadId) return;
    navigation.navigate('VideoCall', {
      channel: threadId,
      title: `${t('video.title')}: ${patientName || t('chat.patient')}`,
    });
  };

  return (
    <View className="flex-1 bg-light">
      <View className="bg-white px-5 py-4 border-b border-lightGray flex-row items-center justify-between">
        <View>
          <Text className="text-lg font-bold text-dark">
            {t('chat.title')}
          </Text>
          <Text className="text-sm text-gray mt-1">
            {t('chat.with')} {patientName || t('chat.patient')}
          </Text>
        </View>
        <TouchableOpacity
          className="px-3 py-2 rounded-full bg-primary/10 flex-row items-center"
          onPress={handleStartCall}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons name="video" size={18} color="#2196F3" />
          <Text className="text-xs text-primary ml-1">{t('video.start')}</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        className="flex-1 px-4"
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const isMine = item.senderId === currentUserId;
          return (
            <View className={`my-2 ${isMine ? 'items-end' : 'items-start'}`}>
              <View
                className={`px-4 py-3 rounded-2xl max-w-[80%] ${
                  isMine ? 'bg-primary' : 'bg-white'
                }`}
              >
                <Text className={`${isMine ? 'text-white' : 'text-dark'}`}>
                  {item.text}
                </Text>
              </View>
            </View>
          );
        }}
      />

      <View className="bg-white px-4 py-3 border-t border-lightGray flex-row items-center">
        <TextInput
          className="flex-1 input-field"
          placeholder={t('chat.placeholder')}
          value={input}
          onChangeText={setInput}
          placeholderTextColor="#BDBDBD"
        />
        <TouchableOpacity
          className={`ml-3 p-3 rounded-full ${canSend ? 'bg-primary' : 'bg-lightGray'}`}
          onPress={handleSend}
          disabled={!canSend}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons name="send" size={18} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default ChatScreen;
