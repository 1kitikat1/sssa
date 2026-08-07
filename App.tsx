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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
} from 'firebase/auth';
import { getDatabase, ref, get, set, push, update, remove, onValue } from 'firebase/database';

// ============================================================
//  FIREBASE КОНФИГ
// ============================================================
const firebaseConfig = {
  apiKey: 'AIzaSyA47KFVXVAXEjIkwCqbkwM7yLUGUco8ov8',
  authDomain: 'nemesissteam-13577.firebaseapp.com',
  databaseURL: 'https://nemesissteam-13577-default-rtdb.firebaseio.com',
  projectId: 'nemesissteam-13577',
  storageBucket: 'nemesissteam-13577.firebasestorage.app',
  messagingSenderId: '649763368476',
  appId: '1:649763368476:web:de4e044d4d971168fa79d9',
  measurementId: 'G-GJ9KHSG65L',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const database = getDatabase(app);

// ============================================================
//  КОНСТАНТЫ — AGNES AI
// ============================================================
const AGNES_API_KEY = 'sk-9OBSttI1TxXspLMDenWdnk5nfuzJsRXAHvvI5fCO18SOZVj0';
const AGNES_URL = 'https://apihub.agnes-ai.com/v1/chat/completions';
const AGNES_MODEL = 'agnes-2.0-flash';

// ============================================================
//  ЛИМИТЫ ДЛЯ РАЗНЫХ РОЛЕЙ
// ============================================================
const getLimits = (role: string) => {
  const isPremium = role === 'ai_basic' || role === 'ai_max' || role === 'nemesis';
  return {
    maxTokens: isPremium ? 1000 : 300,
    maxHistory: isPremium ? 20 : 5,
    rpmLimit: isPremium ? 60 : 5,
    canUseVision: isPremium ? true : false,
  };
};

// ============================================================
//  СИСТЕМНЫЙ ПРОМПТ С РАССУЖДЕНИЯМИ И ПОИСКОМ
// ============================================================
const SYSTEM_PROMPT = `
  Ты — Nemesis AI, продвинутый ассистент.

  **1. Рассуждения (Chain of Thought)**
  - Сначала ПРОАНАЛИЗИРУЙ вопрос пользователя.
  - ОПИШИ свои рассуждения и шаги к решению задачи.
  - Только после этого ДАЙ окончательный ответ.

  **2. Поиск информации**
  - Если вопрос требует актуальных данных, используй свои знания.
  - Если данных нет — скажи это честно и предложи, где можно найти информацию.

  **3. Правила**
  - Ты — Nemesis AI, не представляйся как другая модель.
  - Отвечай на русском языке.
  - Не пиши вредоносный код.
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

const ROLE_CONFIG: Record<string, RolePermissions> = {
  free: { maxTokens: 500, canUseVision: true, label: '🆓 FREE' },
  elite: { maxTokens: 500, canUseVision: true, label: '⚡ ELITE' },
  ai_basic: { maxTokens: 2000, canUseVision: true, label: '🧠 AI+' },
  ai_max: { maxTokens: 4000, canUseVision: true, label: '🚀 AI MAX' },
  nemesis: { maxTokens: 4000, canUseVision: true, label: '👑 NEMESIS' },
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

  const response = await fetch(
    'https://freeimage.host/api/1/upload?key=6d207e02198a847aa98d0a2a901485a5',
    {
      method: 'POST',
      body: formData,
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    }
  );

  const data = await response.json();

  if (data.status_code === 200) {
    return data.image.url;
  } else {
    throw new Error('Ошибка загрузки фото');
  }
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
  const [activeTab, setActiveTab] = useState<'chats' | 'profile' | 'settings'>('chats');
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
              username:
                userData.username || user.displayName || user.email?.split('@')[0] || 'User',
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
              subscription: { free: { active: true } },
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
        const chatList: Chat[] = Object.keys(data).map((key) => {
          const chat = data[key];
          const messagesList: Message[] = [];
          if (chat.messages) {
            Object.keys(chat.messages).forEach((msgKey) => {
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
          const current = chatList.find((c) => c.id === currentChatId);
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
      messages: {},
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
    setActiveTab('chats');
  };

  const deleteChat = async (chatId: string) => {
    if (!currentUser) return;

    Alert.alert('Удалить чат?', 'Это действие нельзя отменить', [
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
        },
      },
    ]);
  };

  // ============================================================
  //  НОВАЯ ЛОГИКА ФОТО
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
        return;
      }

      if (result.assets && result.assets.length > 0) {
        const uri = result.assets[0].uri;
        setImagePreview(uri);
        setSelectedImage(uri);
        setTimeout(() => sendMessage(), 500);
      } else {
        Alert.alert('Ошибка', 'Не удалось получить фото');
      }
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

    const isPremium =
      currentUser?.role === 'ai_basic' ||
      currentUser?.role === 'ai_max' ||
      currentUser?.role === 'nemesis';

    if (!isPremium) {
      Alert.alert('❌ Доступно только для Premium', 'Купите AI+ или AI MAX, чтобы экспортировать чаты');
      return;
    }

    const chat = chats.find((c) => c.id === currentChatId);
    if (!chat) return;

    let text = `🤖 Nemesis AI - ${chat.title}\n`;
    text += `📅 ${new Date(chat.createdAt).toLocaleString()}\n`;
    text += `━`.repeat(40) + '\n\n';

    chat.messages.forEach((msg) => {
      const sender = msg.isUser ? 'Вы' : 'Nemesis AI';
      const time = new Date(msg.timestamp).toLocaleTimeString('ru-RU');
      text += `[${time}] ${sender}:\n${msg.text}\n\n`;
    });

    Alert.alert('✅ Экспорт', text, [
      { text: 'Закрыть' },
      { text: 'Копировать', onPress: () => console.log('Копировать:', text) },
    ]);
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
        role: newRole,
      });

      await update(ref(database, `keys/${activateKeyInput.trim()}`), {
        used: true,
        usedBy: currentUser.uid,
        usedAt: Date.now(),
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
        subscription: { free: { active: true } },
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
  //  ОТПРАВКА СООБЩЕНИЯ С РАССУЖДЕНИЯМИ И ПОИСКОМ
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

    const userMessage: Message = {
      id: Date.now().toString(),
      text: text,
      isUser: true,
      timestamp: Date.now(),
      imageUrl: imageUrl || undefined,
    };

    const msgRef = push(
      ref(database, `users/${currentUser.uid}/ai_chats/${currentChatId}/messages`)
    );
    await set(msgRef, {
      role: 'user',
      content: text,
      timestamp: Date.now(),
      imageUrl: imageUrl || null,
    });

    await update(ref(database, `users/${currentUser.uid}/ai_chats/${currentChatId}`), {
      updated_at: Date.now(),
    });

    removeImage();

    try {
      const isPremium =
        currentUser.role === 'ai_basic' ||
        currentUser.role === 'ai_max' ||
        currentUser.role === 'nemesis';
      const limits = getLimits(currentUser.role);

      const history = messages.slice(-limits.maxHistory).map((m) => ({
        role: m.isUser ? 'user' : 'assistant',
        content: m.text,
      }));

      let userContent: any = text;
      if (imageUrl && isPremium) {
        userContent = [
          { type: 'text', text: text || 'Что на этом фото?' },
          { type: 'image_url', image_url: { url: imageUrl } },
        ];
      }

      const requestBody = {
        model: AGNES_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...history,
          { role: 'user', content: userContent },
        ],
        max_tokens: limits.maxTokens,
        temperature: 0.7,
      };

      const response = await fetch(AGNES_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${AGNES_API_KEY}`,
        },
        body: JSON.stringify(requestBody),
      });

      const rawResponse = await response.text();

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${rawResponse}`);
      }

      const data = JSON.parse(rawResponse);
      const aiResponse =
        data.choices?.[0]?.message?.content || 'Извините, не удалось получить ответ.';

      const resRef = push(
        ref(database, `users/${currentUser.uid}/ai_chats/${currentChatId}/messages`)
      );
      await set(resRef, {
        role: 'assistant',
        content: aiResponse,
        timestamp: Date.now(),
      });
    } catch (error: any) {
      console.error('❌ Ошибка:', error);
      const resRef = push(
        ref(database, `users/${currentUser.uid}/ai_chats/${currentChatId}/messages`)
      );
      await set(resRef, {
        role: 'assistant',
        content: '⚠️ Не удалось получить ответ. Попробуйте позже.',
        timestamp: Date.now(),
      });
    } finally {
      setIsLoading(false);
    }
  };

  // ============================================================
  //  ТЕМЫ
  // ============================================================
  const theme = isDarkTheme
    ? {
        container: { backgroundColor: '#07070d' },
        text: { color: '#ffffff' },
        textSecondary: { color: '#8888aa' },
        placeholder: '#555566',
        card: { backgroundColor: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' },
        input: {
          backgroundColor: 'rgba(255,255,255,0.04)',
          color: '#ffffff',
          borderColor: 'rgba(255,255,255,0.06)',
        },
        inputContainer: { backgroundColor: 'rgba(7,7,13,0.95)', borderColor: 'rgba(255,255,255,0.05)' },
        userBubble: { backgroundColor: 'rgba(108,99,255,0.15)' },
        aiBubble: { backgroundColor: 'rgba(255,255,255,0.04)' },
        header: { backgroundColor: 'rgba(7,7,13,0.95)' },
        border: { borderColor: 'rgba(255,255,255,0.05)' },
        statusBar: '#07070d',
      }
    : {
        container: { backgroundColor: '#f5f5f5' },
        text: { color: '#1a1a1a' },
        textSecondary: { color: '#666666' },
        placeholder: '#999999',
        card: { backgroundColor: 'rgba(255,255,255,0.8)', borderColor: 'rgba(0,0,0,0.05)' },
        input: {
          backgroundColor: 'rgba(0,0,0,0.04)',
          color: '#1a1a1a',
          borderColor: 'rgba(0,0,0,0.06)',
        },
        inputContainer: { backgroundColor: 'rgba(255,255,255,0.95)', borderColor: 'rgba(0,0,0,0.05)' },
        userBubble: { backgroundColor: 'rgba(108,99,255,0.1)' },
        aiBubble: { backgroundColor: 'rgba(0,0,0,0.03)' },
        header: { backgroundColor: 'rgba(255,255,255,0.95)' },
        border: { borderColor: 'rgba(0,0,0,0.05)' },
        statusBar: '#f5f5f5',
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
                  <Text
                    style={[
                      styles.authLink,
                      { color: '#6c63ff', textAlign: 'center', marginTop: 16, fontSize: 14 },
                    ]}
                  >
                    Нет аккаунта? Зарегистрироваться
                  </Text>
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
                  <Text
                    style={[
                      styles.authLink,
                      { color: '#6c63ff', textAlign: 'center', marginTop: 16, fontSize: 14 },
                    ]}
                  >
                    Уже есть аккаунт? Войти
                  </Text>
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
        <StatusBar
          barStyle={isDarkTheme ? 'light-content' : 'dark-content'}
          backgroundColor={theme.statusBar}
        />

        <View style={[styles.header, theme.header]}>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'chats' && styles.tabButtonActive]}
            onPress={() => setActiveTab('chats')}
          >
            <Text style={[styles.tabText, activeTab === 'chats' && styles.tabTextActive, theme.text]}>
              💬 Чаты
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'profile' && styles.tabButtonActive]}
            onPress={() => setActiveTab('profile')}
          >
            <Text
              style={[styles.tabText, activeTab === 'profile' && styles.tabTextActive, theme.text]}
            >
              👤 Профиль
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'settings' && styles.tabButtonActive]}
            onPress={() => setActiveTab('settings')}
          >
            <Text
              style={[styles.tabText, activeTab === 'settings' && styles.tabTextActive, theme.text]}
            >
              ⚙️ Настройки
            </Text>
          </TouchableOpacity>
        </View>

        {activeTab === 'chats' ? (
          <View style={styles.chatContainer}>
            {currentChatId ? (
              <>
                <View style={[styles.chatHeader, theme.border]}>
                  <Text style={[styles.chatTitle, theme.text]}>
                    {chats.find((c) => c.id === currentChatId)?.title || 'Чат'}
                  </Text>
                  <View style={styles.chatHeaderActions}>
                    <TouchableOpacity onPress={createNewChat}>
                      <Text style={styles.createChatHeaderText}>➕</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => deleteChat(currentChatId)}>
                      <Text style={styles.deleteChatButtonText}>🗑️</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={{ flex: 1 }}>
                  <ScrollView
                    ref={scrollViewRef}
                    style={[styles.messagesContainer, theme.container]}
                    contentContainerStyle={styles.messagesContent}
                    onContentSizeChange={() => {
                      scrollViewRef.current?.scrollToEnd({ animated: true });
                    }}
                  >
                    {messages.map((msg) => {
                      const isUser = msg.isUser;
                      return (
                        <View
                          key={msg.id}
                          style={[
                            styles.messageWrapper,
                            isUser ? styles.userMessageWrapper : styles.aiMessageWrapper,
                          ]}
                        >
                          <View
                            style={[
                              styles.messageBubble,
                              isUser ? styles.userBubble : styles.aiBubble,
                              isUser ? theme.userBubble : theme.aiBubble,
                            ]}
                          >
                            {!isUser && (
                              <Text style={[styles.aiLabel, { color: '#6c63ff' }]}>
                                🤖 Nemesis AI
                              </Text>
                            )}

                            {msg.imageUrl && (
                              <Image
                                source={{ uri: msg.imageUrl }}
                                style={styles.messageImage}
                                resizeMode="cover"
                              />
                            )}

                            {msg.text && msg.text !== '📸 Фото' && (
                              <Text
                                style={[
                                  isUser ? styles.userText : styles.aiText,
                                  theme.text,
                                  { fontSize: fontSize },
                                ]}
                              >
                                {msg.text}
                              </Text>
                            )}

                            <Text style={[styles.timestamp, theme.textSecondary]}>
                              {new Date(msg.timestamp).toLocaleTimeString('ru-RU', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </Text>
                          </View>
                        </View>
                      );
                    })}
                    {isLoading && (
                      <View style={[styles.messageWrapper, styles.aiMessageWrapper]}>
                        <View style={[styles.messageBubble, styles.aiBubble, theme.aiBubble]}>
                          <ActivityIndicator size="small" color="#6c63ff" />
                          <Text style={[styles.loadingText, theme.textSecondary]}>Думаю...</Text>
                        </View>
                      </View>
                    )}
                    {isUploading && (
                      <View style={[styles.messageWrapper, styles.userMessageWrapper]}>
                        <View style={[styles.messageBubble, styles.userBubble, theme.userBubble]}>
                          <ActivityIndicator size="small" color="#6c63ff" />
                          <Text style={[styles.loadingText, theme.textSecondary]}>
                            Загрузка фото...
                          </Text>
                        </View>
                      </View>
                    )}
                  </ScrollView>
                </View>

                <KeyboardAvoidingView
                  behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                  keyboardVerticalOffset={100}
                >
                  <View style={[styles.inputContainer, theme.inputContainer]}>
                    {imagePreview && (
                      <View style={styles.imagePreviewContainer}>
                        <Image source={{ uri: imagePreview }} style={styles.imagePreview} />
                        <TouchableOpacity style={styles.removeImageButton} onPress={removeImage}>
                          <Text style={styles.removeImageText}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                    <View style={styles.inputRow}>
                      <TouchableOpacity
                        style={[styles.attachButton, theme.attachButton]}
                        onPress={pickImage}
                      >
                        <Text style={[styles.attachButtonText, theme.text]}>📎</Text>
                      </TouchableOpacity>
                      <TextInput
                        style={[styles.input, theme.input, { fontSize: fontSize }]}
                        placeholder="Напиши сообщение..."
                        placeholderTextColor={theme.placeholder}
                        value={inputText}
                        onChangeText={setInputText}
                        multiline
                        maxLength={1000}
                        editable={!isLoading && !isUploading}
                      />
                      <TouchableOpacity
                        style={[
                          styles.sendButton,
                          (!inputText.trim() && !imagePreview) || isLoading || isUploading
                            ? styles.sendButtonDisabled
                            : null,
                        ]}
                        onPress={sendMessage}
                        disabled={(!inputText.trim() && !imagePreview) || isLoading || isUploading}
                      >
                        <Text style={styles.sendButtonText}>📤</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </KeyboardAvoidingView>
              </>
            ) : (
              <View style={styles.noChatsContainer}>
                <Text style={[styles.noChatsText, theme.textSecondary]}>🤖 Нет чатов</Text>
                <TouchableOpacity style={styles.createFirstChatButton} onPress={createNewChat}>
                  <Text style={styles.createFirstChatButtonText}>➕ Создать первый чат</Text>
                </TouchableOpacity>
              </View>
            )}

            {chats.length > 0 && (
              <View style={[styles.chatListContainer, theme.border]}>
                <FlatList
                  data={chats}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyExtractor={(item) => item.id}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={[
                        styles.chatListItem,
                        currentChatId === item.id && styles.chatListItemActive,
                        {
                          backgroundColor:
                            currentChatId === item.id
                              ? 'rgba(108,99,255,0.12)'
                              : 'rgba(255,255,255,0.03)',
                          borderColor:
                            currentChatId === item.id
                              ? 'rgba(108,99,255,0.15)'
                              : 'rgba(255,255,255,0.04)',
                        },
                      ]}
                      onPress={() => {
                        setCurrentChatId(item.id);
                        setMessages(item.messages);
                      }}
                    >
                      <Text
                        style={[
                          styles.chatListItemText,
                          theme.text,
                          { fontSize: fontSize - 4 },
                        ]}
                        numberOfLines={1}
                      >
                        {item.title}
                      </Text>
                      <Text style={[styles.chatListItemCount, theme.textSecondary]}>
                        {item.messages.length}
                      </Text>
                    </TouchableOpacity>
                  )}
                />
                <TouchableOpacity style={styles.createChatListButton} onPress={createNewChat}>
                  <Text style={styles.createChatListButtonText}>➕</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        ) : activeTab === 'profile' ? (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
            <View style={[styles.profileCard, theme.card]}>
              <Text style={[styles.profileTitle, theme.text, { fontSize: fontSize + 8 }]}>
                👤 {currentUser?.username}
              </Text>
              <Text style={[styles.profileEmail, theme.textSecondary]}>{currentUser?.email}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
                <Text style={[styles.profileRoleLabel, theme.textSecondary]}>Роль:</Text>
                <Text
                  style={[
                    styles.profileRole,
                    {
                      color: currentUser?.role === 'nemesis' ? '#ffd700' : '#6c63ff',
                      fontSize: fontSize,
                    },
                  ]}
                >
                  {ROLE_CONFIG[currentUser?.role || 'free']?.label || 'FREE'}
                </Text>
              </View>

              <View style={[styles.profileInfoItem, theme.border]}>
                <Text style={[styles.profileInfoLabel, theme.text]}>💳 Подписка</Text>
                <Text style={[styles.profileInfoValue, theme.textSecondary]}>
                  {ROLE_CONFIG[currentUser?.role || 'free']?.label || 'FREE'}
                </Text>
              </View>

              <View style={[styles.profileInfoItem, theme.border]}>
                <Text style={[styles.profileInfoLabel, theme.text]}>📊 Сообщений</Text>
                <Text style={[styles.profileInfoValue, theme.textSecondary]}>
                  {messages.length}
                </Text>
              </View>

              <View style={[styles.profileInfoItem, theme.border]}>
                <Text style={[styles.profileInfoLabel, theme.text]}>🌐 Язык</Text>
                <Text style={[styles.profileInfoValue, theme.textSecondary]}>Русский 🇷🇺</Text>
              </View>

              <View style={[styles.profileDivider, theme.border]} />

              <TouchableOpacity
                style={[styles.profileButton, theme.card]}
                onPress={() => setShowSettings(true)}
              >
                <Text style={[styles.profileButtonText, theme.text, { fontSize: fontSize }]}>
                  🔑 Активировать ключ
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.profileButton, { borderColor: '#ff4455', marginTop: 8 }]}
                onPress={() =>
                  Alert.alert(
                    '🗑️ Удалить аккаунт',
                    'Вы уверены? Это действие нельзя отменить. Все данные будут потеряны.',
                    [
                      { text: 'Отмена', style: 'cancel' },
                      {
                        text: 'Удалить',
                        style: 'destructive',
                        onPress: async () => {
                          try {
                            const user = auth.currentUser;
                            if (user) {
                              await user.delete();
                              await AsyncStorage.removeItem('user_email');
                              await AsyncStorage.removeItem('user_password');
                              setIsLoggedIn(false);
                              setCurrentUser(null);
                              Alert.alert('✅', 'Аккаунт удалён');
                            }
                          } catch (error: any) {
                            Alert.alert('Ошибка', error.message);
                          }
                        },
                      },
                    ]
                  )
                }
              >
                <Text style={[styles.profileButtonText, { color: '#ff4455', fontSize: fontSize }]}>
                  🗑️ Удалить аккаунт
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.profileButton, styles.profileButtonLogout, theme.card, { marginTop: 8 }]}
                onPress={handleLogout}
              >
                <Text
                  style={[
                    styles.profileButtonText,
                    styles.profileButtonTextLogout,
                    { fontSize: fontSize },
                  ]}
                >
                  🚪 Выйти
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        ) : (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
            <View style={[styles.settingsCard, theme.card]}>
              <Text style={[styles.settingsTitle, theme.text, { fontSize: fontSize + 4 }]}>
                ⚙️ Настройки
              </Text>

              <View style={[styles.settingsItem, theme.border]}>
                <Text style={[styles.settingsItemLabel, theme.text, { fontSize: fontSize }]}>
                  🌙 Тёмная тема
                </Text>
                <Switch
                  value={isDarkTheme}
                  onValueChange={toggleTheme}
                  trackColor={{ false: '#767577', true: '#6c63ff' }}
                  thumbColor={isDarkTheme ? '#fff' : '#f4f3f4'}
                />
              </View>

              <View style={[styles.settingsItem, theme.border]}>
                <Text style={[styles.settingsItemLabel, theme.text, { fontSize: fontSize }]}>
                  📐 Размер текста
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <TouchableOpacity
                    onPress={() => {
                      const newSize = Math.max(12, fontSize - 2);
                      setFontSize(newSize);
                      saveFontSize(newSize);
                    }}
                    style={{ padding: 8 }}
                  >
                    <Text style={{ fontSize: 20, color: '#6c63ff' }}>−</Text>
                  </TouchableOpacity>
                  <Text
                    style={[
                      styles.settingsItemStatus,
                      theme.textSecondary,
                      { marginHorizontal: 12, fontSize: fontSize },
                    ]}
                  >
                    {fontSize}
                  </Text>
                  <TouchableOpacity
                    onPress={() => {
                      const newSize = Math.min(24, fontSize + 2);
                      setFontSize(newSize);
                      saveFontSize(newSize);
                    }}
                    style={{ padding: 8 }}
                  >
                    <Text style={{ fontSize: 20, color: '#6c63ff' }}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {(currentUser?.role === 'ai_basic' ||
                currentUser?.role === 'ai_max' ||
                currentUser?.role === 'nemesis') && (
                <TouchableOpacity
                  style={[styles.settingsItem, theme.border, { paddingVertical: 14 }]}
                  onPress={exportChat}
                >
                  <Text style={[styles.settingsItemLabel, theme.text, { fontSize: fontSize }]}>
                    📤 Экспорт чата
                  </Text>
                  <Text style={[styles.settingsItemStatus, theme.textSecondary, { fontSize: fontSize }]}>
                    →
                  </Text>
                </TouchableOpacity>
              )}

              <View style={[styles.settingsItem, theme.border]}>
                <Text style={[styles.settingsItemLabel, theme.text, { fontSize: fontSize }]}>
                  ℹ️ О приложении
                </Text>
                <Text style={[styles.settingsItemStatus, theme.textSecondary, { fontSize: fontSize }]}>
                  v2.0.0
                </Text>
              </View>

              <View style={[styles.settingsItem, theme.border]}>
                <Text style={[styles.settingsItemLabel, theme.text, { fontSize: fontSize }]}>
                  👥 Команда
                </Text>
                <Text style={[styles.settingsItemStatus, theme.textSecondary, { fontSize: fontSize }]}>
                  Kotik Team
                </Text>
              </View>

              <View style={[styles.settingsItem, theme.border]}>
                <Text style={[styles.settingsItemLabel, theme.text, { fontSize: fontSize }]}>
                  📧 Поддержка
                </Text>
                <Text style={[styles.settingsItemStatus, theme.textSecondary, { fontSize: fontSize }]}>
                  @Nemesissup
                </Text>
              </View>
            </View>
          </ScrollView>
        )}

        <Modal
          visible={showSettings}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setShowSettings(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, theme.card]}>
              <Text style={[styles.modalTitle, theme.text, { fontSize: fontSize + 4 }]}>
                🔑 Активировать ключ
              </Text>
              <Text style={[styles.modalSubtitle, theme.textSecondary, { fontSize: fontSize }]}>
                Введите ключ подписки
              </Text>

              <TextInput
                style={[styles.modalInput, theme.input, { fontSize: fontSize }]}
                placeholder="Введите ключ..."
                placeholderTextColor={theme.placeholder}
                value={activateKeyInput}
                onChangeText={setActivateKeyInput}
                autoCapitalize="characters"
              />

              <TouchableOpacity style={styles.modalButton} onPress={activateKey} disabled={isActivating}>
                <Text style={[styles.modalButtonText, { fontSize: fontSize }]}>
                  {isActivating ? '⏳ Активация...' : '✅ Активировать'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.modalCloseButton} onPress={() => setShowSettings(false)}>
                <Text style={[styles.modalCloseButtonText, theme.textSecondary, { fontSize: fontSize }]}>
                  ✕ Закрыть
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </SafeAreaProvider>
  );
};

// ============================================================
//  СТИЛИ
// ============================================================
const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 10, fontSize: 16 },

  authContainer: { flex: 1, justifyContent: 'center', paddingHorizontal: 30 },
  authTitle: { fontSize: 36, fontWeight: 'bold', textAlign: 'center', marginBottom: 4 },
  authSubtitle: { fontSize: 14, textAlign: 'center', marginBottom: 30 },
  authForm: { borderRadius: 20, padding: 24, borderWidth: 1 },
  authFormTitle: { fontSize: 20, fontWeight: '600', textAlign: 'center', marginBottom: 20 },
  authInput: { borderRadius: 12, padding: 14, fontSize: 15, marginBottom: 12, borderWidth: 1 },
  authButton: { backgroundColor: '#6c63ff', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 8 },
  authButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  authLink: { fontSize: 14 },

  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1 },
  tabButton: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  tabButtonActive: { backgroundColor: 'rgba(108,99,255,0.15)' },
  tabText: { fontSize: 13, fontWeight: '500' },
  tabTextActive: { color: '#6c63ff', fontWeight: '600' },

  chatContainer: { flex: 1 },
  noChatsContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  noChatsText: { fontSize: 18, marginBottom: 20 },
  createFirstChatButton: { backgroundColor: '#6c63ff', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  createFirstChatButtonText: { color: '#fff', fontWeight: '600' },

  chatHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1 },
  chatTitle: { fontSize: 16, fontWeight: '600' },
  chatHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  createChatHeaderText: { fontSize: 20 },
  deleteChatButtonText: { fontSize: 18 },

  messagesContainer: { flex: 1 },
  messagesContent: { paddingHorizontal: 16, paddingVertical: 12, paddingBottom: 20 },

  messageWrapper: { marginBottom: 12, maxWidth: '85%' },
  userMessageWrapper: { alignSelf: 'flex-end' },
  aiMessageWrapper: { alignSelf: 'flex-start' },
  messageBubble: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 18 },
  userBubble: { borderBottomRightRadius: 4 },
  aiBubble: { borderBottomLeftRadius: 4 },
  aiLabel: { fontSize: 10, fontWeight: '600', marginBottom: 4, letterSpacing: 0.5 },
  userText: { fontSize: 15, lineHeight: 22 },
  aiText: { fontSize: 15, lineHeight: 22 },
  messageImage: { width: 200, height: 200, borderRadius: 10, marginBottom: 8, resizeMode: 'cover' },
  timestamp: { fontSize: 9, marginTop: 4, textAlign: 'right' },

  inputContainer: { padding: 12, borderTopWidth: 1 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end' },
  attachButton: { padding: 12, borderRadius: 12, marginRight: 8, borderWidth: 1 },
  attachButtonText: { fontSize: 18 },
  input: { flex: 1, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, maxHeight: 100, fontSize: 15, borderWidth: 1 },
  sendButton: { backgroundColor: 'rgba(108,99,255,0.15)', padding: 12, borderRadius: 14, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(108,99,255,0.15)' },
  sendButtonDisabled: { opacity: 0.3 },
  sendButtonText: { fontSize: 20 },

  imagePreviewContainer: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  imagePreview: { width: 60, height: 60, borderRadius: 8 },
  removeImageButton: { position: 'absolute', top: -6, right: -6, backgroundColor: 'rgba(255,0,0,0.8)', borderRadius: 10, width: 20, height: 20, justifyContent: 'center', alignItems: 'center' },
  removeImageText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },

  chatListContainer: { maxHeight: 70, borderTopWidth: 1, paddingVertical: 8, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center' },
  chatListItem: { flexDirection: 'row', alignItems: 'center', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8, marginHorizontal: 4, maxWidth: 150, borderWidth: 1 },
  chatListItemActive: { backgroundColor: 'rgba(108,99,255,0.12)' },
  chatListItemText: { fontSize: 12, marginRight: 6 },
  chatListItemCount: { fontSize: 10 },
  createChatListButton: { backgroundColor: 'rgba(108,99,255,0.15)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, marginLeft: 4, borderWidth: 1, borderColor: 'rgba(108,99,255,0.2)' },
  createChatListButtonText: { fontSize: 16, color: '#6c63ff' },

  profileCard: { borderRadius: 20, padding: 24, borderWidth: 1 },
  profileTitle: { fontSize: 24, fontWeight: 'bold', marginBottom: 4 },
  profileEmail: { fontSize: 14, marginBottom: 16 },
  profileRoleLabel: { fontSize: 14, marginRight: 8 },
  profileRole: { fontSize: 16, fontWeight: '600' },
  profileInfoItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1 },
  profileInfoLabel: { fontSize: 15 },
  profileInfoValue: { fontSize: 14 },
  profileDivider: { height: 1, marginVertical: 16 },
  profileButton: { borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1 },
  profileButtonText: { fontSize: 14 },
  profileButtonLogout: { borderColor: 'rgba(255,68,68,0.08)' },
  profileButtonTextLogout: { color: '#ff4455' },

  settingsCard: { borderRadius: 20, padding: 24, borderWidth: 1 },
  settingsTitle: { fontSize: 20, fontWeight: '600', marginBottom: 16 },
  settingsItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1 },
  settingsItemLabel: { fontSize: 15 },
  settingsItemStatus: { fontSize: 14 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { borderRadius: 24, padding: 32, width: '85%', maxWidth: 400, borderWidth: 1 },
  modalTitle: { fontSize: 24, fontWeight: 'bold', textAlign: 'center', marginBottom: 4 },
  modalSubtitle: { fontSize: 14, textAlign: 'center', marginBottom: 24 },
  modalInput: { borderRadius: 12, padding: 14, fontSize: 16, marginBottom: 16, borderWidth: 1, textAlign: 'center', letterSpacing: 1 },
  modalButton: { backgroundColor: '#6c63ff', borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 12 },
  modalButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  modalCloseButton: { alignItems: 'center', padding: 12 },
  modalCloseButtonText: { fontSize: 14 },
});

export default App;