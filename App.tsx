import React, { useState, useEffect, useRef } from 'react';
import {
  ScrollView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Modal,
  FlatList,
  StatusBar,
  Image,
  Switch,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile
} from 'firebase/auth';
import { getDatabase, ref, get, set, push, update, remove, onValue } from 'firebase/database';

// ============================================================
//  FIREBASE КОНФИГ
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyA47KFVXVAXEjIkwCqbkwM7yLUGUco8ov8",
  authDomain: "nemesissteam-13577.firebaseapp.com",
  databaseURL: "https://nemesissteam-13577-default-rtdb.firebaseio.com",
  projectId: "nemesissteam-13577",
  storageBucket: "nemesissteam-13577.firebasestorage.app",
  messagingSenderId: "649763368476",
  appId: "1:649763368476:web:de4e044d4d971168fa79d9",
  measurementId: "G-GJ9KHSG65L"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const database = getDatabase(app);

// ============================================================
//  КОНСТАНТЫ — AGNES API
// ============================================================
const AGNES_API_KEY = 'sk-9OBSttI1TxXspLMDenWdnk5nfuzJsRXAHvvI5fCO18SOZVj0';
const AGNES_URL = 'https://apihub.agnes-ai.com/v1/chat/completions';
const AGNES_MODEL = 'agnes-2.0-flash';

// ============================================================
//  ЛИМИТЫ ТОКЕНОВ ПО РОЛЯМ
// ============================================================
const getMaxTokensForRole = (role: string) => {
  switch (role) {
    case 'nemesis':
    case 'ai_max':
    case 'ai_basic':
      return 5000;
    case 'elite':
      return 1500;
    default:
      return 1500;
  }
};

// ============================================================
//  СИСТЕМНЫЙ ПРОМПТ
// ============================================================
const SYSTEM_PROMPT = `
Ты — Nemesis AI. Твоё имя — Nemesis AI. Ты создан командой Kotik Team.
Ты помогаешь с легальными вопросами: программирование, учёба, творчество, анализ данных.
Отвечаешь кратко, понятно, с душой, на русском языке.
Ты НЕ AGNES, НЕ ChatGPT, НЕ Claude. Ты — Nemesis AI.

ПРАВИЛА ОФОРМЛЕНИЯ КОДА:
- Любой код ВСЕГДА оформляй в блок \`\`\`язык ... \`\`\`.
- Один блок кода = один язык.
`;

// ============================================================
//  ТИПЫ
// ============================================================
type Message = {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: number;
  imageUrl?: string;
};

type Chat = {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
};

type User = {
  uid: string;
  username: string;
  email: string;
  role: string;
  createdAt: number;
};

type RolePermissions = {
  maxTokens: number;
  canUseVision: boolean;
  label: string;
};

type Mode = 'standard' | 'reasoning' | 'search';

const ROLE_CONFIG: Record<string, RolePermissions> = {
  free: { maxTokens: 1500, canUseVision: true, label: '🆓 FREE' },
  elite: { maxTokens: 1500, canUseVision: true, label: '⚡ ELITE' },
  ai_basic: { maxTokens: 5000, canUseVision: true, label: '🧠 AI+' },
  ai_max: { maxTokens: 5000, canUseVision: true, label: '🚀 AI MAX' },
  nemesis: { maxTokens: 5000, canUseVision: true, label: '👑 NEMESIS' },
};

// ============================================================
//  ЗАГРУЗКА ФОТО
// ============================================================
const uploadImage = async (uri: string): Promise<string> => {
  const formData = new FormData();
  // @ts-ignore
  formData.append('source', {
    uri: uri,
    type: 'image/jpeg',
    name: 'photo.jpg',
  });

  const response = await fetch(`https://freeimage.host/api/1/upload?key=6d207e02198a847aa98d0a2a901485a5`, {
    method: 'POST',
    body: formData,
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });

  const data = await response.json();

  if (data.status_code === 200) {
    return data.image.url;
  } else {
    throw new Error('Ошибка загрузки фото');
  }
};

// ============================================================
//  ПАРСИНГ КОДА
// ============================================================
const parseCodeBlocks = (text: string) => {
  const parts: { type: 'text' | 'code'; content: string; lang?: string }[] = [];
  const regex = /```(\w+)?\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    parts.push({ type: 'code', lang: match[1] || 'plaintext', content: match[2] });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push({ type: 'text', content: text.slice(lastIndex) });
  }

  return parts;
};

// ============================================================
//  ОСНОВНОЙ КОМПОНЕНТ
// ============================================================
const App = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);

  const [isDarkTheme, setIsDarkTheme] = useState(true);
  const [fontSize, setFontSize] = useState(16);

  const [chats, setChats] = useState<Chat[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [regUsername, setRegUsername] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');

  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const [showRegister, setShowRegister] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [activateKeyInput, setActivateKeyInput] = useState('');
  const [isActivating, setIsActivating] = useState(false);

  const scrollViewRef = useRef<ScrollView>(null);

  // ============================================================
  //  ЗАГРУЗКА ТЕМЫ, РАЗМЕРА И СЕССИИ
  // ============================================================
  useEffect(() => {
    loadTheme();
    loadFontSize();
    loadUserSession();
  }, []);

  const loadTheme = async () => {
    try {
      const theme = await AsyncStorage.getItem('nemesis_theme');
      if (theme !== null) {
        setIsDarkTheme(theme === 'dark');
      }
    } catch (error) {
      console.error('Ошибка загрузки темы:', error);
    }
  };

  const toggleTheme = async () => {
    const newTheme = !isDarkTheme;
    setIsDarkTheme(newTheme);
    try {
      await AsyncStorage.setItem('nemesis_theme', newTheme ? 'dark' : 'light');
    } catch (error) {
      console.error('Ошибка сохранения темы:', error);
    }
  };

  const loadFontSize = async () => {
    try {
      const saved = await AsyncStorage.getItem('fontSize');
      if (saved) {
        setFontSize(parseInt(saved));
      }
    } catch (error) {
      console.error('Ошибка загрузки размера шрифта:', error);
    }
  };

  const saveFontSize = async (size: number) => {
    try {
      await AsyncStorage.setItem('fontSize', String(size));
    } catch (error) {
      console.error('Ошибка сохранения размера шрифта:', error);
    }
  };

  // ============================================================
  //  СОХРАНЕНИЕ АККАУНТА
  // ============================================================
  const saveUserSession = async (email: string, password: string) => {
    try {
      await AsyncStorage.setItem('user_email', email);
      await AsyncStorage.setItem('user_password', password);
    } catch (error) {
      console.error('Ошибка сохранения сессии:', error);
    }
  };

  const loadUserSession = async () => {
    try {
      const email = await AsyncStorage.getItem('user_email');
      const password = await AsyncStorage.getItem('user_password');
      if (email && password) {
        setLoginEmail(email);
        setLoginPassword(password);
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (error) {
      console.error('Ошибка загрузки сессии:', error);
    }
  };

  // ============================================================
  //  FIREBASE АВТОРИЗАЦИЯ
  // ============================================================
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          const userRef = ref(database, `users/${user.uid}`);
          const snapshot = await get(userRef);
          const userData = snapshot.val();

          if (userData) {
            setCurrentUser({
              uid: user.uid,
              username: userData.username || user.displayName || user.email?.split('@')[0] || 'User',
              email: user.email || '',
              role: userData.role || 'free',
              createdAt: userData.createdAt || Date.now(),
            });
            setIsLoggedIn(true);
            loadChats(user.uid);
          } else {
            const newUserData = {
              username: user.displayName || user.email?.split('@')[0] || 'User',
              email: user.email || '',
              role: 'free',
              createdAt: Date.now(),
              subscription: { free: { active: true } }
            };
            await set(ref(database, `users/${user.uid}`), newUserData);

            setCurrentUser({
              uid: user.uid,
              username: newUserData.username,
              email: newUserData.email,
              role: 'free',
              createdAt: newUserData.createdAt,
            });
            setIsLoggedIn(true);
            loadChats(user.uid);
          }
        } catch (error) {
          console.error('Ошибка загрузки данных пользователя:', error);
        }
      } else {
        setIsLoggedIn(false);
        setCurrentUser(null);
        setChats([]);
        setMessages([]);
        setCurrentChatId(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const loadChats = (uid: string) => {
    const chatsRef = ref(database, `users/${uid}/ai_chats`);
    onValue(chatsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const chatList: Chat[] = Object.keys(data).map(key => {
          const chat = data[key];
          const messagesList: Message[] = [];
          if (chat.messages) {
            Object.keys(chat.messages).forEach(msgKey => {
              const msg = chat.messages[msgKey];
              messagesList.push({
                id: msgKey,
                text: msg.content || '',
                isUser: msg.role === 'user',
                timestamp: msg.timestamp || Date.now(),
                imageUrl: msg.imageUrl || undefined,
              });
            });
          }
          return {
            id: key,
            title: chat.title || 'Новый чат',
            messages: messagesList.sort((a, b) => a.timestamp - b.timestamp),
            createdAt: chat.created_at || Date.now(),
            updatedAt: chat.updated_at || Date.now(),
          };
        });
        chatList.sort((a, b) => b.updatedAt - a.updatedAt);
        setChats(chatList);

        if (currentChatId) {
          const current = chatList.find(c => c.id === currentChatId);
          if (current) {
            setMessages(current.messages);
          }
        } else if (chatList.length > 0) {
          setCurrentChatId(chatList[0].id);
          setMessages(chatList[0].messages);
        }
      } else {
        setChats([]);
        setMessages([]);
        setCurrentChatId(null);
      }
    });
  };

  const createNewChat = async () => {
    if (!currentUser) return;

    const chatId = `chat_${Date.now()}`;
    const chatRef = ref(database, `users/${currentUser.uid}/ai_chats/${chatId}`);
    await set(chatRef, {
      title: 'Новый чат',
      created_at: Date.now(),
      updated_at: Date.now(),
      messages: {}
    });

    const newChat: Chat = {
      id: chatId,
      title: 'Новый чат',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    setChats([newChat, ...chats]);
    setCurrentChatId(chatId);
    setMessages([]);
  };

  const deleteChat = async (chatId: string) => {
    if (!currentUser) return;

    Alert.alert(
      'Удалить чат?',
      'Это действие нельзя отменить',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: async () => {
            await remove(ref(database, `users/${currentUser.uid}/ai_chats/${chatId}`));
            if (currentChatId === chatId) {
              setCurrentChatId(null);
              setMessages([]);
            }
          }
        }
      ]
    );
  };

  // ============================================================
  //  ФОТО
  // ============================================================
  const pickImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (status !== 'granted') {
        Alert.alert('⚠️', 'Нет доступа к галерее');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaType.Images,
        quality: 0.5,
        allowsEditing: false,
      });

      if (result.canceled) {
        console.log('📸 Пользователь отменил выбор');
        return;
      }

      if (!result.assets || result.assets.length === 0) {
        Alert.alert('Ошибка', 'Не удалось получить фото');
        return;
      }

      const uri = result.assets[0].uri;
      console.log('📸 Фото выбрано:', uri);

      setImagePreview(uri);
      setSelectedImage(uri);

      setTimeout(() => {
        sendMessage();
      }, 500);

    } catch (error) {
      console.error('❌ Ошибка выбора фото:', error);
      Alert.alert('Ошибка', 'Не удалось выбрать фото. Попробуйте ещё раз.');
    }
  };

  const removeImage = () => {
    setImagePreview(null);
    setSelectedImage(null);
  };

  // ============================================================
  //  ЭКСПОРТ ЧАТА
  // ============================================================
  const exportChat = async () => {
    if (!currentChatId) {
      Alert.alert('Ошибка', 'Выберите чат для экспорта');
      return;
    }

    const isPremium = currentUser?.role === 'ai_basic' ||
                      currentUser?.role === 'ai_max' ||
                      currentUser?.role === 'nemesis';

    if (!isPremium) {
      Alert.alert(
        '❌ Доступно только для Premium',
        'Купите AI+ или AI MAX, чтобы экспортировать чаты'
      );
      return;
    }

    const chat = chats.find(c => c.id === currentChatId);
    if (!chat) return;

    let text = `🤖 Nemesis AI - ${chat.title}\n`;
    text += `📅 ${new Date(chat.createdAt).toLocaleString()}\n`;
    text += `━`.repeat(40) + '\n\n';

    chat.messages.forEach(msg => {
      const sender = msg.isUser ? 'Вы' : 'Nemesis AI';
      const time = new Date(msg.timestamp).toLocaleTimeString('ru-RU');
      text += `[${time}] ${sender}:\n${msg.text}\n\n`;
    });

    try {
      await Clipboard.setStringAsync(text);
      Alert.alert('✅ Экспорт', 'Чат скопирован в буфер обмена');
    } catch {
      Alert.alert('✅ Экспорт', text);
    }
  };

  // ============================================================
  //  АКТИВАЦИЯ КЛЮЧА
  // ============================================================
  const activateKey = async () => {
    if (!currentUser || !activateKeyInput.trim()) return;

    setIsActivating(true);
    try {
      const keyRef = ref(database, `keys/${activateKeyInput.trim()}`);
      const snapshot = await get(keyRef);
      const keyData = snapshot.val();

      if (!keyData) {
        Alert.alert('Ошибка', 'Неверный ключ');
        setIsActivating(false);
        return;
      }

      if (keyData.used) {
        Alert.alert('Ошибка', 'Ключ уже использован');
        setIsActivating(false);
        return;
      }

      const currentRole = currentUser.role || 'free';
      let newRole = currentRole;
      const plan = keyData.plan;

      if (plan === 'elite' && currentRole === 'ai_basic') newRole = 'ai_max';
      else if (plan === 'ai_basic' && currentRole === 'elite') newRole = 'ai_max';
      else if (plan === 'ai_max') newRole = 'ai_max';
      else newRole = plan;

      await update(ref(database, `users/${currentUser.uid}`), {
        role: newRole
      });

      await update(ref(database, `keys/${activateKeyInput.trim()}`), {
        used: true,
        usedBy: currentUser.uid,
        usedAt: Date.now()
      });

      setCurrentUser({ ...currentUser, role: newRole });
      setActivateKeyInput('');
      setIsActivating(false);
      Alert.alert('✅ Успешно!', `Подписка активирована! Роль: ${newRole.toUpperCase()}`);
    } catch (error) {
      Alert.alert('Ошибка', 'Не удалось активировать ключ');
      setIsActivating(false);
    }
  };

  const handleLogin = async () => {
    if (!loginEmail || !loginPassword) {
      Alert.alert('Ошибка', 'Заполните все поля');
      return;
    }

    try {
      await signInWithEmailAndPassword(auth, loginEmail, loginPassword);
      await saveUserSession(loginEmail, loginPassword);
      setLoginEmail('');
      setLoginPassword('');
    } catch (error: any) {
      Alert.alert('Ошибка входа', error.message);
    }
  };

  const handleRegister = async () => {
    if (!regUsername || !regEmail || !regPassword) {
      Alert.alert('Ошибка', 'Заполните все поля');
      return;
    }

    if (regPassword.length < 6) {
      Alert.alert('Ошибка', 'Пароль должен быть минимум 6 символов');
      return;
    }

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, regEmail, regPassword);
      const user = userCredential.user;

      await updateProfile(user, { displayName: regUsername });

      await set(ref(database, `users/${user.uid}`), {
        username: regUsername,
        email: regEmail,
        role: 'free',
        createdAt: Date.now(),
        subscription: { free: { active: true } }
      });

      Alert.alert('✅ Успешно!', 'Аккаунт создан! Теперь войдите.');
      setShowRegister(false);
      setRegUsername('');
      setRegEmail('');
      setRegPassword('');
    } catch (error: any) {
      Alert.alert('Ошибка регистрации', error.message);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      await AsyncStorage.removeItem('user_email');
      await AsyncStorage.removeItem('user_password');
      setIsLoggedIn(false);
      setCurrentUser(null);
      setChats([]);
      setMessages([]);
      setCurrentChatId(null);
    } catch (error: any) {
      Alert.alert('Ошибка', error.message);
    }
  };

  // ============================================================
  //  СТРИМ-ЗАПРОС К AGNES
  // ============================================================
  const streamOnce = async (
    reqMessages: { role: string; content: any }[],
    maxTokens: number,
    onChunk: (chunk: string) => void
  ): Promise<{ text: string; finishReason: string | null }> => {
    const response = await fetch(AGNES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AGNES_API_KEY}`,
      },
      body: JSON.stringify({
        model: AGNES_MODEL,
        messages: reqMessages,
        max_tokens: maxTokens,
        temperature: 0.5,
        stream: true,
      }),
    });

    if (!response.ok) {
      const rawResponse = await response.text();
      throw new Error(`HTTP ${response.status}: ${rawResponse}`);
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    if (!reader) throw new Error('Нет ответа от сервера');

    let buffer = '';
    let text = '';
    let finishReason: string | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          const choice = json.choices?.[0];
          const chunk = choice?.delta?.content || '';
          if (chunk) {
            text += chunk;
            onChunk(chunk);
          }
          if (choice?.finish_reason) finishReason = choice.finish_reason;
        } catch (_) {}
      }
    }

    return { text, finishReason };
  };

  // ============================================================
  //  ОТПРАВКА СООБЩЕНИЯ
  // ============================================================
  const sendMessage = async () => {
    if ((!inputText.trim() && !selectedImage) || isLoading || !currentUser || !currentChatId) return;

    const text = inputText.trim() || '📸 Фото';
    setInputText('');
    setIsLoading(true);

    let imageUrl = null;
    if (selectedImage) {
      setIsUploading(true);
      try {
        imageUrl = await uploadImage(selectedImage);
      } catch (error) {
        Alert.alert('Ошибка', 'Не удалось загрузить фото');
        setIsUploading(false);
        setIsLoading(false);
        return;
      }
      setIsUploading(false);
    }

    const msgRef = push(ref(database, `users/${currentUser.uid}/ai_chats/${currentChatId}/messages`));
    await set(msgRef, {
      role: 'user',
      content: text,
      timestamp: Date.now(),
      imageUrl: imageUrl || null,
    });

    await update(ref(database, `users/${currentUser.uid}/ai_chats/${currentChatId}`), {
      updated_at: Date.now()
    });

    removeImage();

    try {
      const lowerMsg = text.toLowerCase();
      if (lowerMsg.includes('вирус') || lowerMsg.includes('вредонос') || lowerMsg.includes('эксплойт')) {
        const warning = '⚠️ Мой создатель, Китикат, против создания вирусов. Я не могу помочь с этим.';
        const resRef = push(ref(database, `users/${currentUser.uid}/ai_chats/${currentChatId}/messages`));
        await set(resRef, { role: 'assistant', content: warning, timestamp: Date.now() });
        setIsLoading(false);
        return;
      }

      const fullSystemPrompt = SYSTEM_PROMPT;
      const maxTokens = getMaxTokensForRole(currentUser.role);

      const history = messages.map(m => ({
        role: m.isUser ? 'user' : 'assistant',
        content: m.text,
      }));

      let userContent: any = text;
      if (imageUrl) {
        userContent = [
          { type: 'text', text: text || 'Что на этом фото?' },
          { type: 'image_url', image_url: { url: imageUrl } }
        ];
      }

      const baseMessages = [...history, { role: 'user', content: userContent }];

      const resRef = push(ref(database, `users/${currentUser.uid}/ai_chats/${currentChatId}/messages`));
      await set(resRef, { role: 'assistant', content: '', timestamp: Date.now() });

      let fullResponse = '';
      let convo = [{ role: 'system', content: fullSystemPrompt }, ...baseMessages];
      let attempt = 0;
      const MAX_CONTINUATIONS = 3;

      while (true) {
        const { text: chunkText, finishReason } = await streamOnce(convo, maxTokens, async (chunk) => {
          fullResponse += chunk;
          await update(ref(database, `users/${currentUser.uid}/ai_chats/${currentChatId}/messages/${resRef.key}`), {
            content: fullResponse,
          });
        });

        if (finishReason !== 'length' || attempt >= MAX_CONTINUATIONS) break;

        attempt++;
        convo = [
          { role: 'system', content: fullSystemPrompt },
          ...baseMessages,
          { role: 'assistant', content: fullResponse },
          { role: 'user', content: 'Продолжи ответ ровно с того места, где остановился. Не повторяй уже написанное и обязательно закрой любой незакрытый блок кода.' },
        ];
      }

      if (!fullResponse || !fullResponse.trim()) {
        await update(ref(database, `users/${currentUser.uid}/ai_chats/${currentChatId}/messages/${resRef.key}`), {
          content: '⚠️ Не удалось получить ответ. Попробуйте позже.',
        });
      }

    } catch (error: any) {
      console.error('❌ Ошибка:', error);

      let userMessage = '⚠️ Не удалось получить ответ от сервера. Попробуйте позже.';

      const errMsg = error.message || '';
      if (errMsg.includes('500') || errMsg.includes('InternalServerError')) {
        userMessage = '⚠️ Сервер временно перегружен. Пожалуйста, подождите пару минут и попробуйте снова. 🙏';
      } else if (errMsg.includes('429')) {
        userMessage = '⚠️ Слишком много запросов. Подождите немного и повторите. ⏳';
      } else if (errMsg.includes('401') || errMsg.includes('403')) {
        userMessage = '⚠️ Ошибка авторизации. Пожалуйста, выйдите и войдите заново. 🔑';
      } else if (errMsg.includes('fetch') || errMsg.includes('network') || errMsg.includes('ENOTFOUND')) {
        userMessage = '⚠️ Нет соединения с интернетом. Проверьте подключение. 📶';
      } else if (errMsg.includes('timeout')) {
        userMessage = '⚠️ Время ожидания истекло. Сервер отвечает слишком долго. ⏰';
      }

      const resRef = push(ref(database, `users/${currentUser.uid}/ai_chats/${currentChatId}/messages`));
      await set(resRef, {
        role: 'assistant',
        content: userMessage,
        timestamp: Date.now()
      });
    } finally {
      setIsLoading(false);
    }
  };

  // ============================================================
  //  РЕНДЕР СООБЩЕНИЯ
  // ============================================================
  const renderMessageContent = (msg: Message) => {
    const parts = parseCodeBlocks(msg.text);

    return parts.map((part, index) => {
      if (part.type === 'text') {
        if (!part.content.trim()) return null;
        return (
          <Text key={index} style={[msg.isUser ? styles.userText : styles.aiText, { fontSize }]}>
            {part.content}
          </Text>
        );
      }

      return (
        <View key={index} style={styles.codeBlock}>
          <View style={styles.codeBlockHeader}>
            <Text style={styles.codeBlockLang}>{part.lang?.toUpperCase() || 'CODE'}</Text>
            <TouchableOpacity
              onPress={async () => {
                await Clipboard.setStringAsync(part.content);
                Alert.alert('✅', 'Код скопирован');
              }}
            >
              <Text style={styles.codeBlockAction}>📋 Копировать</Text>
            </TouchableOpacity>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Text style={styles.codeBlockText}>{part.content}</Text>
          </ScrollView>
        </View>
      );
    });
  };

  // ============================================================
  //  ТЕМЫ
  // ============================================================
  const theme = isDarkTheme ? {
    container: { backgroundColor: '#07070d' },
    text: { color: '#ffffff' },
    textSecondary: { color: '#8888aa' },
    placeholder: '#555566',
    card: { backgroundColor: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' },
    input: { backgroundColor: 'rgba(255,255,255,0.04)', color: '#ffffff', borderColor: 'rgba(255,255,255,0.06)' },
    inputContainer: { backgroundColor: 'rgba(7,7,13,0.95)', borderColor: 'rgba(255,255,255,0.05)' },
    userBubble: { backgroundColor: 'rgba(108,99,255,0.15)' },
    aiBubble: { backgroundColor: 'rgba(255,255,255,0.04)' },
    header: { backgroundColor: 'rgba(7,7,13,0.95)' },
    border: { borderColor: 'rgba(255,255,255,0.05)' },
    statusBar: '#07070d',
    codeBg: '#1a1a2e',
    sidebarBg: 'rgba(255,255,255,0.02)',
  } : {
    container: { backgroundColor: '#f5f5f5' },
    text: { color: '#1a1a1a' },
    textSecondary: { color: '#666666' },
    placeholder: '#999999',
    card: { backgroundColor: 'rgba(255,255,255,0.8)', borderColor: 'rgba(0,0,0,0.05)' },
    input: { backgroundColor: 'rgba(0,0,0,0.04)', color: '#1a1a1a', borderColor: 'rgba(0,0,0,0.06)' },
    inputContainer: { backgroundColor: 'rgba(255,255,255,0.95)', borderColor: 'rgba(0,0,0,0.05)' },
    userBubble: { backgroundColor: 'rgba(108,99,255,0.1)' },
    aiBubble: { backgroundColor: 'rgba(0,0,0,0.03)' },
    header: { backgroundColor: 'rgba(255,255,255,0.95)' },
    border: { borderColor: 'rgba(0,0,0,0.05)' },
    statusBar: '#f5f5f5',
    codeBg: '#e8e8e8',
    sidebarBg: 'rgba(0,0,0,0.02)',
  };

  // ============================================================
  //  РЕНДЕР
  // ============================================================
  if (loading) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={[styles.container, theme.container]}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#6c63ff" />
            <Text style={[styles.loadingText, theme.text]}>Загрузка...</Text>
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  if (!isLoggedIn) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={[styles.container, theme.container]}>
          <View style={styles.authContainer}>
            <View style={styles.authLogo}>
              <Text style={styles.authLogoText}>N</Text>
            </View>
            <Text style={[styles.authTitle, theme.text]}>🤖 Nemesis AI</Text>
            <Text style={[styles.authSubtitle, theme.textSecondary]}>Создан командой Kotik Team</Text>

            {!showRegister ? (
              <View style={[styles.authForm, theme.card]}>
                <Text style={[styles.authFormTitle, theme.text]}>Вход</Text>
                <TextInput
                  style={[styles.authInput, theme.input]}
                  placeholder="Email"
                  placeholderTextColor={theme.placeholder}
                  value={loginEmail}
                  onChangeText={setLoginEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
                <TextInput
                  style={[styles.authInput, theme.input]}
                  placeholder="Пароль"
                  placeholderTextColor={theme.placeholder}
                  value={loginPassword}
                  onChangeText={setLoginPassword}
                  secureTextEntry
                />
                <TouchableOpacity style={styles.authButton} onPress={handleLogin}>
                  <Text style={styles.authButtonText}>Войти</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setShowRegister(true)}>
                  <Text style={[styles.authLink, { color: '#6c63ff', textAlign: 'center', marginTop: 16, fontSize: 14 }]}>Нет аккаунта? Зарегистрироваться</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={[styles.authForm, theme.card]}>
                <Text style={[styles.authFormTitle, theme.text]}>Регистрация</Text>
                <TextInput
                  style={[styles.authInput, theme.input]}
                  placeholder="Имя пользователя"
                  placeholderTextColor={theme.placeholder}
                  value={regUsername}
                  onChangeText={setRegUsername}
                />
                <TextInput
                  style={[styles.authInput, theme.input]}
                  placeholder="Email"
                  placeholderTextColor={theme.placeholder}
                  value={regEmail}
                  onChangeText={setRegEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
                <TextInput
                  style={[styles.authInput, theme.input]}
                  placeholder="Пароль (мин. 6)"
                  placeholderTextColor={theme.placeholder}
                  value={regPassword}
                  onChangeText={setRegPassword}
                  secureTextEntry
                />
                <TouchableOpacity style={styles.authButton} onPress={handleRegister}>
                  <Text style={styles.authButtonText}>Зарегистрироваться</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setShowRegister(false)}>
                  <Text style={[styles.authLink, { color: '#6c63ff', textAlign: 'center', marginTop: 16, fontSize: 14 }]}>Уже есть аккаунт? Войти</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={[styles.container, theme.container]}>
        <StatusBar barStyle={isDarkTheme ? 'light-content' : 'dark-content'} backgroundColor={theme.statusBar} />

        <View style={styles.mainLayout}>
          {/* САЙДБАР — как на сайте */}
          <View style={[styles.sidebar, { backgroundColor: theme.sidebarBg, borderColor: theme.border.borderColor }]}>
            {/* Профиль */}
            <View style={styles.sidebarProfile}>
              <View style={styles.sidebarAvatar}>
                <Text style={styles.sidebarAvatarText}>
                  {currentUser?.username?.[0]?.toUpperCase() || 'U'}
                </Text>
              </View>
              <View style={styles.sidebarProfileInfo}>
                <Text style={[styles.sidebarName, theme.text]} numberOfLines={1}>
                  {currentUser?.username || 'Пользователь'}
                </Text>
                <Text style={[styles.sidebarRole, styles[`role_${currentUser?.role || 'free'}`]]}>
                  {ROLE_CONFIG[currentUser?.role || 'free']?.label || '🆓 FREE'}
                </Text>
              </View>
              <TouchableOpacity style={styles.sidebarLogout} onPress={handleLogout}>
                <Text style={styles.sidebarLogoutText}>⏻</Text>
              </TouchableOpacity>
            </View>

            {/* Список чатов */}
            <View style={styles.sidebarChats}>
              <View style={styles.sidebarChatsHeader}>
                <Text style={[styles.sidebarChatsTitle, theme.textSecondary]}>📋 Мои чаты</Text>
                <TouchableOpacity style={styles.sidebarNewChat} onPress={createNewChat}>
                  <Text style={styles.sidebarNewChatText}>+ Новый</Text>
                </TouchableOpacity>
              </View>
              <ScrollView style={styles.sidebarChatList}>
                {chats.length === 0 ? (
                  <Text style={[styles.sidebarEmpty, theme.textSecondary]}>Нет чатов</Text>
                ) : (
                  chats.map(chat => (
                    <TouchableOpacity
                      key={chat.id}
                      style={[
                        styles.sidebarChatItem,
                        currentChatId === chat.id && styles.sidebarChatItemActive,
                      ]}
                      onPress={() => {
                        setCurrentChatId(chat.id);
                        setMessages(chat.messages);
                      }}
                    >
                      <Text style={[styles.sidebarChatTitle, theme.text]} numberOfLines={1}>
                        {chat.title}
                      </Text>
                      <View style={styles.sidebarChatRight}>
                        <Text style={[styles.sidebarChatCount, theme.textSecondary]}>
                          {chat.messages.length}
                        </Text>
                        <TouchableOpacity onPress={() => deleteChat(chat.id)}>
                          <Text style={styles.sidebarChatDelete}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    </TouchableOpacity>
                  ))
                )}
              </ScrollView>
            </View>
          </View>

          {/* ОСНОВНОЕ ОКНО ЧАТА */}
          <View style={styles.chatWindow}>
            {currentChatId ? (
              <>
                <View style={[styles.chatHeader, { borderBottomColor: theme.border.borderColor }]}>
                  <Text style={[styles.chatHeaderTitle, theme.text]}>
                    {chats.find(c => c.id === currentChatId)?.title || 'Чат'}
                  </Text>
                  <TouchableOpacity onPress={createNewChat}>
                    <Text style={styles.chatHeaderNew}>➕</Text>
                  </TouchableOpacity>
                </View>

                <ScrollView
                  ref={scrollViewRef}
                  style={[styles.chatMessagesContainer, theme.container]}
                  contentContainerStyle={styles.chatMessagesContent}
                  onContentSizeChange={() => scrollViewRef.current?.scrollToEnd()}
                >
                  {messages.length === 0 && (
                    <Text style={[styles.chatEmpty, theme.textSecondary]}>
                      🤖 Начните диалог с Nemesis AI
                    </Text>
                  )}
                  {messages.map((msg) => {
                    const isUser = msg.isUser;
                    return (
                      <View key={msg.id} style={[styles.msgWrapper, isUser ? styles.msgUserWrapper : styles.msgAiWrapper]}>
                        <View style={[styles.msgBubble, isUser ? styles.msgUserBubble : styles.msgAiBubble, isUser ? theme.userBubble : theme.aiBubble]}>
                          {!isUser && <Text style={[styles.msgAiLabel, { color: '#6c63ff' }]}>🤖 Nemesis AI</Text>}
                          {msg.imageUrl && (
                            <Image source={{ uri: msg.imageUrl }} style={styles.msgImage} resizeMode="cover" />
                          )}
                          {msg.text && msg.text !== '📸 Фото' && renderMessageContent(msg)}
                          <Text style={[styles.msgTimestamp, theme.textSecondary]}>
                            {new Date(msg.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                  {isLoading && (
                    <View style={[styles.msgWrapper, styles.msgAiWrapper]}>
                      <View style={[styles.msgBubble, styles.msgAiBubble, theme.aiBubble]}>
                        <ActivityIndicator size="small" color="#6c63ff" />
                        <Text style={[styles.msgLoadingText, theme.textSecondary]}>Думаю...</Text>
                      </View>
                    </View>
                  )}
                  {isUploading && (
                    <View style={[styles.msgWrapper, styles.msgUserWrapper]}>
                      <View style={[styles.msgBubble, styles.msgUserBubble, theme.userBubble]}>
                        <ActivityIndicator size="small" color="#6c63ff" />
                        <Text style={[styles.msgLoadingText, theme.textSecondary]}>Загрузка фото...</Text>
                      </View>
                    </View>
                  )}
                </ScrollView>

                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={100}>
                  <View style={[styles.inputContainer, { borderTopColor: theme.border.borderColor, backgroundColor: theme.inputContainer.backgroundColor }]}>
                    {imagePreview && (
                      <View style={styles.inputPreviewContainer}>
                        <Image source={{ uri: imagePreview }} style={styles.inputPreviewImage} />
                        <TouchableOpacity style={styles.inputPreviewRemove} onPress={removeImage}>
                          <Text style={styles.inputPreviewRemoveText}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                    <View style={styles.inputRow}>
                      <TouchableOpacity style={[styles.inputAttach, { borderColor: theme.border.borderColor }]} onPress={pickImage}>
                        <Text style={[styles.inputAttachText, theme.text]}>📎</Text>
                      </TouchableOpacity>
                      <TextInput
                        style={[styles.inputField, theme.input, { fontSize }]}
                        placeholder="Напиши сообщение..."
                        placeholderTextColor={theme.placeholder}
                        value={inputText}
                        onChangeText={setInputText}
                        multiline
                        maxLength={1000}
                        editable={!isLoading && !isUploading}
                      />
                      <TouchableOpacity
                        style={[styles.inputSend, (!inputText.trim() && !imagePreview) || isLoading || isUploading ? styles.inputSendDisabled : null]}
                        onPress={sendMessage}
                        disabled={(!inputText.trim() && !imagePreview) || isLoading || isUploading}
                      >
                        <Text style={styles.inputSendText}>📤</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </KeyboardAvoidingView>
              </>
            ) : (
              <View style={styles.noChatContainer}>
                <Text style={[styles.noChatText, theme.textSecondary]}>🤖 Нет чатов</Text>
                <TouchableOpacity style={styles.noChatButton} onPress={createNewChat}>
                  <Text style={styles.noChatButtonText}>➕ Создать первый чат</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>

        {/* Модалка активации ключа */}
        <Modal
          visible={showSettings}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setShowSettings(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, theme.card]}>
              <Text style={[styles.modalTitle, theme.text, { fontSize: fontSize + 4 }]}>🔑 Активировать ключ</Text>
              <Text style={[styles.modalSubtitle, theme.textSecondary, { fontSize }]}>Введите ключ подписки</Text>

              <TextInput
                style={[styles.modalInput, theme.input, { fontSize }]}
                placeholder="Введите ключ..."
                placeholderTextColor={theme.placeholder}
                value={activateKeyInput}
                onChangeText={setActivateKeyInput}
                autoCapitalize="characters"
              />

              <TouchableOpacity style={styles.modalButton} onPress={activateKey} disabled={isActivating}>
                <Text style={[styles.modalButtonText, { fontSize }]}>
                  {isActivating ? '⏳ Активация...' : '✅ Активировать'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.modalClose} onPress={() => setShowSettings(false)}>
                <Text style={[styles.modalCloseText, theme.textSecondary, { fontSize }]}>✕ Закрыть</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </SafeAreaProvider>
  );
};

// ============================================================
//  СТИЛИ (как на сайте)
// ============================================================
const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 10, fontSize: 16 },

  // ===== АВТОРИЗАЦИЯ =====
  authContainer: { flex: 1, justifyContent: 'center', paddingHorizontal: 30, alignItems: 'center' },
  authLogo: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: 'rgba(108,99,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(108,99,255,0.1)',
  },
  authLogoText: { fontSize: 28, fontWeight: '800', color: '#6c63ff' },
  authTitle: { fontSize: 30, fontWeight: 'bold', textAlign: 'center', marginBottom: 4 },
  authSubtitle: { fontSize: 14, textAlign: 'center', marginBottom: 30 },
  authForm: { borderRadius: 20, padding: 24, borderWidth: 1, width: '100%' },
  authFormTitle: { fontSize: 20, fontWeight: '600', textAlign: 'center', marginBottom: 20 },
  authInput: { borderRadius: 12, padding: 14, fontSize: 15, marginBottom: 12, borderWidth: 1 },
  authButton: { backgroundColor: '#6c63ff', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 8 },
  authButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  authLink: { fontSize: 14 },

  // ===== ОСНОВНОЙ ЛЕЙАУТ =====
  mainLayout: { flex: 1, flexDirection: 'row', gap: 16, paddingHorizontal: 16, paddingVertical: 12 },

  // ===== САЙДБАР =====
  sidebar: { width: 260, borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  sidebarProfile: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)', gap: 12 },
  sidebarAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(108,99,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(108,99,255,0.1)',
  },
  sidebarAvatarText: { fontSize: 14, fontWeight: '700', color: '#6c63ff' },
  sidebarProfileInfo: { flex: 1 },
  sidebarName: { fontSize: 14, fontWeight: '600' },
  sidebarRole: { fontSize: 10, paddingHorizontal: 10, paddingVertical: 2, borderRadius: 12, alignSelf: 'flex-start', marginTop: 2 },
  role_free: { backgroundColor: 'rgba(255,255,255,0.05)', color: '#8888aa' },
  role_elite: { backgroundColor: 'rgba(108,99,255,0.1)', color: '#6c63ff' },
  role_ai_basic: { backgroundColor: 'rgba(108,99,255,0.15)', color: '#6c63ff' },
  role_ai_max: { backgroundColor: 'rgba(255,215,0,0.1)', color: '#ffd700' },
  role_nemesis: { backgroundColor: 'rgba(255,215,0,0.2)', color: '#ffd700' },
  sidebarLogout: { padding: 6 },
  sidebarLogoutText: { color: '#ff4455', fontSize: 16 },

  sidebarChats: { flex: 1, padding: 14 },
  sidebarChatsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sidebarChatsTitle: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  sidebarNewChat: { backgroundColor: 'rgba(108,99,255,0.15)', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8 },
  sidebarNewChatText: { color: '#6c63ff', fontSize: 11, fontWeight: '600' },
  sidebarChatList: { flex: 1 },
  sidebarEmpty: { textAlign: 'center', paddingTop: 20, fontSize: 13 },
  sidebarChatItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, marginBottom: 2 },
  sidebarChatItemActive: { backgroundColor: 'rgba(108,99,255,0.08)' },
  sidebarChatTitle: { fontSize: 13, flex: 1 },
  sidebarChatRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sidebarChatCount: { fontSize: 10 },
  sidebarChatDelete: { color: '#555566', fontSize: 12, paddingHorizontal: 4 },

  // ===== ОКНО ЧАТА =====
  chatWindow: { flex: 1, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', overflow: 'hidden' },
  chatHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  chatHeaderTitle: { fontSize: 16, fontWeight: '600' },
  chatHeaderNew: { fontSize: 18 },

  chatMessagesContainer: { flex: 1 },
  chatMessagesContent: { paddingHorizontal: 16, paddingVertical: 12, paddingBottom: 20 },
  chatEmpty: { textAlign: 'center', paddingTop: 60, fontSize: 16 },

  // ===== СООБЩЕНИЯ =====
  msgWrapper: { marginBottom: 12, maxWidth: '85%' },
  msgUserWrapper: { alignSelf: 'flex-end' },
  msgAiWrapper: { alignSelf: 'flex-start' },
  msgBubble: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 18 },
  msgUserBubble: { borderBottomRightRadius: 4 },
  msgAiBubble: { borderBottomLeftRadius: 4 },
  msgAiLabel: { fontSize: 10, fontWeight: '600', marginBottom: 4, letterSpacing: 0.5 },
  msgUserText: { fontSize: 15, lineHeight: 22, color: '#fff' },
  msgAiText: { fontSize: 15, lineHeight: 22, color: '#ccc' },
  msgImage: { width: 200, height: 200, borderRadius: 10, marginBottom: 8, resizeMode: 'cover' },
  msgTimestamp: { fontSize: 9, marginTop: 4, textAlign: 'right' },
  msgLoadingText: { marginLeft: 8, fontSize: 14 },

  // ===== КОД-БЛОКИ =====
  codeBlock: { borderRadius: 10, borderWidth: 1, borderColor: 'rgba(108,99,255,0.15)', marginVertical: 6, overflow: 'hidden' },
  codeBlockHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, backgroundColor: 'rgba(255,255,255,0.04)' },
  codeBlockLang: { color: '#6c63ff', fontSize: 10, fontWeight: '700' },
  codeBlockAction: { color: '#fff', fontSize: 11, fontWeight: '600' },
  codeBlockText: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12, color: '#e0e0e0', padding: 10 },

  // ===== ВВОД =====
  inputContainer: { padding: 12, borderTopWidth: 1 },
  inputPreviewContainer: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  inputPreviewImage: { width: 60, height: 60, borderRadius: 8 },
  inputPreviewRemove: { position: 'absolute', top: -6, right: -6, backgroundColor: 'rgba(255,0,0,0.8)', borderRadius: 10, width: 20, height: 20, justifyContent: 'center', alignItems: 'center' },
  inputPreviewRemoveText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end' },
  inputAttach: { padding: 12, borderRadius: 12, marginRight: 8, borderWidth: 1 },
  inputAttachText: { fontSize: 18 },
  inputField: { flex: 1, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, maxHeight: 100, fontSize: 15, borderWidth: 1 },
  inputSend: { backgroundColor: 'rgba(108,99,255,0.15)', padding: 12, borderRadius: 14, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(108,99,255,0.15)' },
  inputSendDisabled: { opacity: 0.3 },
  inputSendText: { fontSize: 20 },

  // ===== НЕТ ЧАТА =====
  noChatContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  noChatText: { fontSize: 18, marginBottom: 20 },
  noChatButton: { backgroundColor: '#6c63ff', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  noChatButtonText: { color: '#fff', fontWeight: '600' },

  // ===== МОДАЛКА =====
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { borderRadius: 24, padding: 32, width: '85%', maxWidth: 400, borderWidth: 1 },
  modalTitle: { fontSize: 24, fontWeight: 'bold', textAlign: 'center', marginBottom: 4 },
  modalSubtitle: { fontSize: 14, textAlign: 'center', marginBottom: 24 },
  modalInput: { borderRadius: 12, padding: 14, fontSize: 16, marginBottom: 16, borderWidth: 1, textAlign: 'center', letterSpacing: 1 },
  modalButton: { backgroundColor: '#6c63ff', borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 12 },
  modalButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  modalClose: { alignItems: 'center', padding: 12 },
  modalCloseText: { fontSize: 14 },
});

export default App;
