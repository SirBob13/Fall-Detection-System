import Voice from '@react-native-voice/voice';

type VoiceHandlers = {
  onResult: (text: string) => void;
  onError?: (message: string) => void;
  onStateChange?: (listening: boolean) => void;
};

class VoiceService {
  private handlers: VoiceHandlers | null = null;
  private listening = false;

  initialize(handlers: VoiceHandlers) {
    this.handlers = handlers;
    Voice.onSpeechStart = () => {
      this.listening = true;
      this.handlers?.onStateChange?.(true);
    };
    Voice.onSpeechEnd = () => {
      this.listening = false;
      this.handlers?.onStateChange?.(false);
    };
    Voice.onSpeechResults = (event) => {
      const results = event.value || [];
      const top = results[0];
      if (top) {
        this.handlers?.onResult(top);
      }
    };
    Voice.onSpeechError = (event) => {
      const message = event.error?.message || 'Voice error';
      this.handlers?.onError?.(message);
      this.handlers?.onStateChange?.(false);
      this.listening = false;
    };
  }

  async start(locale: string) {
    try {
      await Voice.start(locale);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Voice start failed';
      this.handlers?.onError?.(message);
    }
  }

  async stop() {
    try {
      await Voice.stop();
    } catch {
      // ignore
    }
  }

  async destroy() {
    try {
      await Voice.destroy();
      await Voice.removeAllListeners();
    } catch {
      // ignore
    }
  }

  isListening() {
    return this.listening;
  }
}

export const voiceService = new VoiceService();
