import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLanguage } from '../components/LanguageProvider';

type VideoCallRouteParams = {
  VideoCall: {
    channel: string;
    title?: string;
  };
};

export const VideoCallScreen: React.FC = () => {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<VideoCallRouteParams, 'VideoCall'>>();
  const { t } = useLanguage();

  return (
    <View className="flex-1 bg-white px-6 py-10 justify-center items-center">
      <View className="w-20 h-20 rounded-full bg-blue-50 items-center justify-center mb-5">
        <MaterialCommunityIcons name="video-off" size={36} color="#2196F3" />
      </View>

      <Text className="text-2xl font-bold text-dark text-center mb-3">
        {route.params?.title || t('video.title')}
      </Text>

      <Text className="text-sm text-gray text-center mb-2">
        Video call screen is temporarily unavailable in this build.
      </Text>

      <Text className="text-xs text-lightGray text-center mb-8">
        Channel: {route.params?.channel || 'N/A'}
      </Text>

      <TouchableOpacity
        className="bg-primary px-6 py-3 rounded-xl flex-row items-center"
        onPress={() => navigation.goBack()}
        activeOpacity={0.8}
      >
        <MaterialCommunityIcons name="arrow-left" size={18} color="#FFFFFF" />
        <Text className="text-white font-semibold ml-2">{t('common.back')}</Text>
      </TouchableOpacity>
    </View>
  );
};

export default VideoCallScreen;
