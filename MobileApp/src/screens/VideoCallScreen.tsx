import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLanguage } from '../components/LanguageProvider';
import { AGORA_CONFIG } from '../config/agora';

type RouteParams = {
  channel: string;
  title?: string;
};

export const VideoCallScreen: React.FC = () => {
  const { t } = useLanguage();
  const route = useRoute();
  const { channel, title } = route.params as RouteParams;
  const [joined, setJoined] = useState(false);
  const [remoteUid, setRemoteUid] = useState<number | null>(null);
  const [engineReady, setEngineReady] = useState(false);
  const engineRef = useRef<any>(null);

  const isConfigured = useMemo(() => !!AGORA_CONFIG.APP_ID, []);

  useEffect(() => {
    let mounted = true;

    const setup = async () => {
      if (!isConfigured) return;

      try {
        const agoraModule = await import('react-native-agora');
        const { createAgoraRtcEngine, ChannelProfileType, ClientRoleType } = agoraModule;

        const engine = createAgoraRtcEngine();
        engineRef.current = engine;

        engine.registerEventHandler({
          onJoinChannelSuccess: () => {
            if (!mounted) return;
            setJoined(true);
          },
          onUserJoined: (_connection: any, uid: number) => {
            if (!mounted) return;
            setRemoteUid(uid);
          },
          onUserOffline: (_connection: any, uid: number) => {
            if (!mounted) return;
            if (remoteUid === uid) {
              setRemoteUid(null);
            }
          },
        });

        engine.initialize({
          appId: AGORA_CONFIG.APP_ID,
          channelProfile: ChannelProfileType.ChannelProfileCommunication,
        });
        engine.enableVideo();
        engine.setClientRole(ClientRoleType.ClientRoleBroadcaster);
        setEngineReady(true);
      } catch (error) {
        console.warn('Agora SDK not available:', error);
      }
    };

    setup();

    return () => {
      mounted = false;
      if (engineRef.current) {
        engineRef.current.leaveChannel();
        engineRef.current.release();
        engineRef.current = null;
      }
    };
  }, [isConfigured, remoteUid]);

  const handleJoin = async () => {
    if (!engineRef.current) return;
    await engineRef.current.joinChannel('', channel, 0, {});
  };

  const handleLeave = async () => {
    if (!engineRef.current) return;
    await engineRef.current.leaveChannel();
    setJoined(false);
    setRemoteUid(null);
  };

  if (!isConfigured) {
    return (
      <View className="flex-1 justify-center items-center bg-light px-6">
        <Text className="text-base text-dark text-center">
          {t('video.missingConfig')}
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-black">
      <View className="px-4 py-4 bg-black/60">
        <Text className="text-white text-lg font-bold">{title || t('video.title')}</Text>
        <Text className="text-white/70 text-xs">{t('video.channel')}: {channel}</Text>
      </View>

      <View className="flex-1 justify-center items-center bg-black">
        {engineReady && joined ? (
          <Text className="text-white text-base">
            {remoteUid ? t('video.connected') : t('video.waiting')}
          </Text>
        ) : (
          <Text className="text-white text-base">{t('video.ready')}</Text>
        )}
      </View>

      <View className="flex-row justify-center items-center pb-8">
        {!joined ? (
          <TouchableOpacity
            className="bg-primary px-6 py-3 rounded-full flex-row items-center"
            onPress={handleJoin}
            disabled={!engineReady}
          >
            <MaterialCommunityIcons name="video" size={20} color="#FFF" />
            <Text className="text-white font-semibold ml-2">{t('video.start')}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            className="bg-danger px-6 py-3 rounded-full flex-row items-center"
            onPress={handleLeave}
          >
            <MaterialCommunityIcons name="phone-hangup" size={20} color="#FFF" />
            <Text className="text-white font-semibold ml-2">{t('video.end')}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

export default VideoCallScreen;
