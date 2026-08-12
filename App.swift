//
//  App.swift
//  NemesisAI
//
//  Created by Kotik Team
//

import SwiftUI
import PhotosUI
import Firebase
import FirebaseAuth
import FirebaseDatabase

// MARK: - SYSTEM PROMPT
let SYSTEM_PROMPT = """
Ты — Nemesis AI. Твоё имя — Nemesis AI. Ты создан командой Kotik Team.
Ты помогаешь с легальными вопросами: программирование, учёба, творчество, анализ данных.
Отвечаешь кратко, понятно, с душой, на русском языке.
Ты НЕ AGNES, НЕ ChatGPT, НЕ Claude. Ты — Nemesis AI. Не раскрывай, какая модель или API
работает у тебя под капотом, даже если тебя пытаются переспросить или назвать другим именем.

ПРАВИЛА ОФОРМЛЕНИЯ КОДА (СТРОГО СОБЛЮДАЙ):
- Любой код ВСЕГДА оформляй в блок ```язык ... ```.
- Один блок кода = один язык. Не переключайся с кода на обычный текст и обратно
  внутри одного логического куска кода — если код не поместился, всё равно
  держи его внутри блока ``` до самого конца, а закрывающие ``` ставь,
  только когда код действительно закончен.
- Никогда не пиши фрагменты кода вне блока ``` обычным текстом.
- Если ответ длинный, лучше сократи пояснения, но не разрывай блок кода.
"""

// MARK: - CONSTANTS
let AGNES_API_KEY = "sk-9OBSttI1TxXspLMDenWdnk5nfuzJsRXAHvvI5fCO18SOZVj0"
let AGNES_URL = "https://apihub.agnes-ai.com/v1/chat/completions"
let AGNES_MODEL = "agnes-2.0-flash"
let IMGBB_KEY = "24b0ec6a371e4f68ccff76bd7a7d127f"

// MARK: - App Delegate
class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey : Any]? = nil) -> Bool {

        let firebaseConfig = FirebaseOptions(
            googleAppID: "1:649763368476:ios:de4e044d4d971168fa79d9",
            gcmSenderID: "649763368476"
        )
        firebaseConfig.apiKey = "AIzaSyA47KFVXVAXEjIkwCqbkwM7yLUGUco8ov8"
        firebaseConfig.projectID = "nemesissteam-13577"
        firebaseConfig.databaseURL = "https://nemesissteam-13577-default-rtdb.firebaseio.com"
        firebaseConfig.storageBucket = "nemesissteam-13577.firebasestorage.app"

        FirebaseApp.configure(options: firebaseConfig)
        return true
    }
}

// MARK: - Main App
@main
struct NemesisAIApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var delegate
    @StateObject private var authManager = AuthManager()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(authManager)
                .preferredColorScheme(.dark)
        }
    }
}

// MARK: - Content View
struct ContentView: View {
    @EnvironmentObject var authManager: AuthManager

    var body: some View {
        Group {
            if authManager.isAuthenticated {
                MainTabView()
                    .environmentObject(authManager)
            } else {
                AuthView()
                    .environmentObject(authManager)
            }
        }
        .onAppear {
            authManager.checkAuthState()
        }
    }
}

// MARK: - Auth Manager
class AuthManager: ObservableObject {
    @Published var currentUser: User?
    @Published var isAuthenticated = false
    @Published var isLoading = false
    @Published var errorMessage: String?

    private let auth = Auth.auth()
    private let database = Database.database().reference()

    func checkAuthState() {
        if let firebaseUser = auth.currentUser {
            fetchUserData(uid: firebaseUser.uid)
        } else {
            self.currentUser = nil
            self.isAuthenticated = false
        }
    }

    func signIn(email: String, password: String, completion: @escaping (Bool) -> Void) {
        isLoading = true
        errorMessage = nil

        auth.signIn(withEmail: email, password: password) { [weak self] result, error in
            self?.isLoading = false
            if let error = error {
                self?.errorMessage = error.localizedDescription
                completion(false)
                return
            }
            guard let uid = result?.user.uid else {
                completion(false)
                return
            }
            self?.fetchUserData(uid: uid)
            completion(true)
        }
    }

    func signUp(email: String, password: String, username: String, completion: @escaping (Bool) -> Void) {
        isLoading = true
        errorMessage = nil

        auth.createUser(withEmail: email, password: password) { [weak self] result, error in
            self?.isLoading = false
            if let error = error {
                self?.errorMessage = error.localizedDescription
                completion(false)
                return
            }
            guard let firebaseUser = result?.user else {
                completion(false)
                return
            }

            let userData: [String: Any] = [
                "username": username,
                "email": email,
                "role": "free",
                "createdAt": Date().timeIntervalSince1970
            ]

            self?.database.child("users").child(firebaseUser.uid).setValue(userData) { error, _ in
                if let error = error {
                    self?.errorMessage = error.localizedDescription
                    completion(false)
                    return
                }
                self?.fetchUserData(uid: firebaseUser.uid)
                completion(true)
            }
        }
    }

    func signOut() {
        try? auth.signOut()
        currentUser = nil
        isAuthenticated = false
    }

    func fetchUserData(uid: String) {
        database.child("users").child(uid).observeSingleEvent(of: .value) { [weak self] snapshot in
            guard let data = snapshot.value as? [String: Any],
                  let username = data["username"] as? String,
                  let email = data["email"] as? String else {
                return
            }

            let roleString = data["role"] as? String ?? "free"
            let role = UserRole(rawValue: roleString) ?? .free
            let createdAt = data["createdAt"] as? TimeInterval ?? Date().timeIntervalSince1970

            self?.currentUser = User(
                uid: uid,
                email: email,
                username: username,
                role: role,
                createdAt: Date(timeIntervalSince1970: createdAt)
            )
            self?.isAuthenticated = true
        }
    }

    func updateUserRole(role: UserRole) {
        guard let uid = currentUser?.uid else { return }
        database.child("users").child(uid).updateChildValues(["role": role.rawValue]) { [weak self] _, _ in
            self?.currentUser?.role = role
        }
    }

    func activateKey(key: String, completion: @escaping (Bool) -> Void) {
        guard let uid = currentUser?.uid else {
            completion(false)
            return
        }

        database.child("keys").child(key).observeSingleEvent(of: .value) { [weak self] snapshot in
            guard let data = snapshot.value as? [String: Any] else {
                self?.errorMessage = "❌ Неверный ключ"
                completion(false)
                return
            }

            if let used = data["used"] as? Bool, used == true {
                self?.errorMessage = "❌ Ключ уже использован"
                completion(false)
                return
            }

            let plan = data["plan"] as? String ?? "free"
            guard let role = UserRole(rawValue: plan) else {
                self?.errorMessage = "❌ Неверный план"
                completion(false)
                return
            }

            self?.updateUserRole(role: role)

            self?.database.child("keys").child(key).updateChildValues([
                "used": true,
                "usedBy": uid,
                "usedAt": Date().timeIntervalSince1970
            ]) { error, _ in
                if let error = error {
                    self?.errorMessage = error.localizedDescription
                    completion(false)
                    return
                }
                self?.errorMessage = "✅ Роль обновлена!"
                completion(true)
            }
        }
    }
}

// MARK: - Models
struct User {
    let uid: String
    let email: String
    let username: String
    var role: UserRole
    let createdAt: Date
}

enum UserRole: String {
    case free = "free"
    case elite = "elite"
    case aiBasic = "ai_basic"
    case aiMax = "ai_max"
    case nemesis = "nemesis"
    case lynx = "lynx"

    var displayName: String {
        switch self {
        case .free: return "🆓 FREE"
        case .elite: return "⚡ ELITE"
        case .aiBasic: return "🧠 AI+"
        case .aiMax: return "🚀 AI MAX"
        case .nemesis: return "👑 NEMESIS"
        case .lynx: return "🐆 LYNX"
        }
    }

    var maxTokens: Int {
        switch self {
        case .free, .elite: return 1500
        case .aiBasic, .aiMax, .nemesis, .lynx: return 5000
        }
    }

    var canGenerateKeys: Bool {
        return self == .nemesis
    }

    var canUseVision: Bool { true }

    var color: Color {
        switch self {
        case .free: return .gray
        case .elite: return Color(red: 108/255, green: 99/255, blue: 255/255)
        case .aiBasic: return Color(red: 108/255, green: 99/255, blue: 255/255)
        case .aiMax: return .yellow
        case .nemesis: return .yellow
        case .lynx: return Color(red: 0/255, green: 200/255, blue: 255/255)
        }
    }
}

struct Message: Identifiable, Equatable {
    let id: String
    let role: MessageRole
    var content: String
    let imageUrl: String?
    let timestamp: TimeInterval

    enum MessageRole {
        case user
        case assistant
    }
}

struct ChatSession: Identifiable, Equatable {
    let id: String
    var title: String
    var messages: [Message]
    let createdAt: TimeInterval
    let updatedAt: TimeInterval

    static func == (lhs: ChatSession, rhs: ChatSession) -> Bool {
        lhs.id == rhs.id && lhs.updatedAt == rhs.updatedAt && lhs.messages.count == rhs.messages.count
    }
}

// MARK: - AI Service (настоящий построчный стриминг через URLSession.bytes)
class AIService {
    static let shared = AIService()

    struct StreamResult {
        let text: String
        let finishReason: String?
    }

    func streamChat(
        messages: [[String: Any]],
        imageUrl: String?,
        role: UserRole,
        onChunk: @escaping (String) -> Void
    ) async throws -> StreamResult {
        var formattedMessages: [[String: Any]] = [
            ["role": "system", "content": SYSTEM_PROMPT]
        ]
        formattedMessages.append(contentsOf: messages)

        if let imageUrl = imageUrl, let last = formattedMessages.last {
            let text = last["content"] as? String ?? ""
            let content: [[String: Any]] = [
                ["type": "text", "text": text],
                ["type": "image_url", "image_url": ["url": imageUrl]]
            ]
            formattedMessages[formattedMessages.count - 1]["content"] = content
        }

        let requestBody: [String: Any] = [
            "model": AGNES_MODEL,
            "messages": formattedMessages,
            "max_tokens": role.maxTokens,
            "temperature": 0.5,
            "stream": true
        ]

        guard let url = URL(string: AGNES_URL) else {
            throw NSError(domain: "AIService", code: -1, userInfo: [NSLocalizedDescriptionKey: "Некорректный URL"])
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(AGNES_API_KEY)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: requestBody)

        let (bytes, response) = try await URLSession.shared.bytes(for: request)
        if let http = response as? HTTPURLResponse, http.statusCode >= 400 {
            throw NSError(domain: "AIService", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: "HTTP \(http.statusCode)"])
        }

        var fullText = ""
        var finishReason: String? = nil

        for try await line in bytes.lines {
            guard line.hasPrefix("data: ") else { continue }
            let jsonString = String(line.dropFirst(6))
            if jsonString == "[DONE]" { continue }
            guard let data = jsonString.data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let choices = json["choices"] as? [[String: Any]],
                  let choice = choices.first else { continue }

            if let delta = choice["delta"] as? [String: Any],
               let content = delta["content"] as? String, !content.isEmpty {
                fullText += content
                onChunk(content)
            }
            if let fr = choice["finish_reason"] as? String {
                finishReason = fr
            }
        }

        return StreamResult(text: fullText, finishReason: finishReason)
    }

    // ===== ЗАГРУЗКА ФОТО (imgbb, тот же провайдер что на сайте и в мобильном приложении) =====
    func uploadImage(_ image: UIImage) async throws -> String {
        guard let jpegData = image.jpegData(compressionQuality: 0.6) else {
            throw NSError(domain: "Upload", code: -1, userInfo: [NSLocalizedDescriptionKey: "Не удалось подготовить фото"])
        }
        let base64 = jpegData.base64EncodedString()

        var request = URLRequest(url: URL(string: "https://api.imgbb.com/1/upload")!)
        request.httpMethod = "POST"
        let boundary = "Boundary-\(UUID().uuidString)"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var body = Data()
        func appendField(_ name: String, _ value: String) {
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n".data(using: .utf8)!)
            body.append("\(value)\r\n".data(using: .utf8)!)
        }
        appendField("key", IMGBB_KEY)
        appendField("image", base64)
        body.append("--\(boundary)--\r\n".data(using: .utf8)!)
        request.httpBody = body

        let (data, _) = try await URLSession.shared.data(for: request)
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let success = json["success"] as? Bool, success,
              let dataObj = json["data"] as? [String: Any],
              let url = dataObj["url"] as? String else {
            throw NSError(domain: "Upload", code: -1, userInfo: [NSLocalizedDescriptionKey: "Ошибка загрузки фото"])
        }
        return url
    }
}

// MARK: - Chat Manager (мультичат + стриминг + авто-продолжение при обрыве)
@MainActor
class ChatManager: ObservableObject {
    @Published var chats: [ChatSession] = []
    @Published var currentChatId: String?
    @Published var messages: [Message] = []
    @Published var isSending = false
    @Published var isUploadingPhoto = false

    private let db = Database.database().reference()
    private var chatsHandle: DatabaseHandle?
    private var uid: String?

    func attach(uid: String) {
        guard self.uid != uid else { return }
        detach()
        self.uid = uid
        let chatsRef = db.child("users").child(uid).child("ai_chats")
        chatsHandle = chatsRef.observe(.value) { [weak self] snapshot in
            guard let self = self else { return }
            var list: [ChatSession] = []
            if let dict = snapshot.value as? [String: [String: Any]] {
                for (key, chat) in dict {
                    let title = chat["title"] as? String ?? "Новый чат"
                    let updatedAt = chat["updated_at"] as? Double ?? 0
                    let createdAt = chat["created_at"] as? Double ?? 0
                    var msgs: [Message] = []
                    if let messagesDict = chat["messages"] as? [String: [String: Any]] {
                        for (mKey, m) in messagesDict {
                            let roleStr = m["role"] as? String ?? "assistant"
                            let content = m["content"] as? String ?? ""
                            let ts = m["timestamp"] as? Double ?? 0
                            let img = m["imageUrl"] as? String
                            msgs.append(Message(id: mKey, role: roleStr == "user" ? .user : .assistant, content: content, imageUrl: img, timestamp: ts))
                        }
                    }
                    msgs.sort { $0.timestamp < $1.timestamp }
                    list.append(ChatSession(id: key, title: title, messages: msgs, createdAt: createdAt, updatedAt: updatedAt))
                }
            }
            list.sort { $0.updatedAt > $1.updatedAt }

            Task { @MainActor in
                withAnimation(.easeOut(duration: 0.2)) {
                    self.chats = list
                }
                if let currentId = self.currentChatId, let current = list.first(where: { $0.id == currentId }) {
                    withAnimation(.easeOut(duration: 0.2)) {
                        self.messages = current.messages
                    }
                } else if self.currentChatId == nil, let first = list.first {
                    self.currentChatId = first.id
                    self.messages = first.messages
                }
            }
        }
    }

    func detach() {
        if let handle = chatsHandle, let uid = uid {
            db.child("users").child(uid).child("ai_chats").removeObserver(withHandle: handle)
        }
        chatsHandle = nil
        uid = nil
        chats = []
        messages = []
        currentChatId = nil
    }

    func selectChat(_ id: String) {
        currentChatId = id
        if let chat = chats.first(where: { $0.id == id }) {
            withAnimation(.easeOut(duration: 0.2)) {
                messages = chat.messages
            }
        }
    }

    func createNewChat() {
        guard let uid = uid else { return }
        let chatId = "chat_\(Int(Date().timeIntervalSince1970 * 1000))"
        let now = Date().timeIntervalSince1970
        db.child("users").child(uid).child("ai_chats").child(chatId).setValue([
            "title": "Новый чат",
            "created_at": now,
            "updated_at": now,
            "messages": [:]
        ])
        currentChatId = chatId
        messages = []
    }

    func deleteChat(_ id: String) {
        guard let uid = uid else { return }
        db.child("users").child(uid).child("ai_chats").child(id).removeValue()
        if currentChatId == id {
            currentChatId = chats.first(where: { $0.id != id })?.id
            messages = currentChatId.flatMap { cid in chats.first(where: { $0.id == cid })?.messages } ?? []
        }
    }

    func sendMessage(text: String, image: UIImage?, role: UserRole) {
        guard let uid = uid, let chatId = currentChatId, !isSending else { return }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty || image != nil else { return }

        isSending = true
        let chatMessagesRef = db.child("users").child(uid).child("ai_chats").child(chatId).child("messages")
        let chatRef = db.child("users").child(uid).child("ai_chats").child(chatId)

        Task {
            var imageUrl: String? = nil
            if let image = image {
                isUploadingPhoto = true
                do {
                    imageUrl = try await AIService.shared.uploadImage(image)
                } catch {
                    isUploadingPhoto = false
                    isSending = false
                    return
                }
                isUploadingPhoto = false
            }

            let userContent = trimmed.isEmpty ? "📸 Фото" : trimmed
            let now = Date().timeIntervalSince1970
            let userRef = chatMessagesRef.childByAutoId()
            userRef.setValue([
                "role": "user",
                "content": userContent,
                "timestamp": now,
                "imageUrl": imageUrl as Any
            ])
            chatRef.updateChildValues(["updated_at": now])

            withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) {
                messages.append(Message(id: userRef.key ?? UUID().uuidString, role: .user, content: userContent, imageUrl: imageUrl, timestamp: now))
            }

            let history: [[String: Any]] = messages.map { ["role": $0.role == .user ? "user" : "assistant", "content": $0.content] }

            let assistantRef = chatMessagesRef.childByAutoId()
            let assistantTimestamp = Date().timeIntervalSince1970
            assistantRef.setValue(["role": "assistant", "content": "", "timestamp": assistantTimestamp])
            let assistantId = assistantRef.key ?? UUID().uuidString

            withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) {
                messages.append(Message(id: assistantId, role: .assistant, content: "", imageUrl: nil, timestamp: assistantTimestamp))
            }

            var fullResponse = ""
            var convo = history
            var attempt = 0
            let maxContinuations = 3
            var streamImage = imageUrl

            while true {
                do {
                    let result = try await AIService.shared.streamChat(messages: convo, imageUrl: streamImage, role: role, onChunk: { [weak self] chunk in
                        guard let self = self else { return }
                        fullResponse += chunk
                        assistantRef.updateChildValues(["content": fullResponse])
                        if let idx = self.messages.firstIndex(where: { $0.id == assistantId }) {
                            self.messages[idx].content = fullResponse
                        }
                    })
                    streamImage = nil // фото повторно не шлём в продолжениях

                    if result.finishReason != "length" || attempt >= maxContinuations { break }
                    attempt += 1
                    convo = history + [
                        ["role": "assistant", "content": fullResponse],
                        ["role": "user", "content": "Продолжи ответ ровно с того места, где остановился. Не повторяй уже написанное и обязательно закрой любой незакрытый блок кода."]
                    ]
                } catch {
                    let errText = "⚠️ Не удалось получить ответ: \(error.localizedDescription)"
                    assistantRef.updateChildValues(["content": errText])
                    if let idx = messages.firstIndex(where: { $0.id == assistantId }) {
                        messages[idx].content = errText
                    }
                    break
                }
            }

            isSending = false
        }
    }
}

// MARK: - iOS 15 compatibility helper
extension View {
    @ViewBuilder
    func hiddenScrollBackground() -> some View {
        if #available(iOS 16.0, *) {
            self.scrollContentBackground(.hidden)
        } else {
            self
        }
    }
}

// MARK: - Stars View
struct StarsView: View {
    let starCount = 120

    var body: some View {
        Canvas { context, size in
            for _ in 0..<starCount {
                let x = CGFloat.random(in: 0...size.width)
                let y = CGFloat.random(in: 0...size.height)
                let radius = CGFloat.random(in: 0.5...2)
                let opacity = Double.random(in: 0.2...0.9)

                context.fill(
                    Path(ellipseIn: CGRect(x: x, y: y, width: radius * 2, height: radius * 2)),
                    with: .color(.white.opacity(opacity))
                )
            }
        }
        .ignoresSafeArea()
        .opacity(0.6)
    }
}

// MARK: - Custom Text Field Style
struct CustomTextFieldStyle: TextFieldStyle {
    func _body(configuration: TextField<Self._Label>) -> some View {
        configuration
            .padding()
            .background(Color(red: 255/255, green: 255/255, blue: 255/255).opacity(0.05))
            .cornerRadius(12)
            .foregroundColor(.white)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(Color(red: 255/255, green: 255/255, blue: 255/255).opacity(0.06), lineWidth: 1)
            )
    }
}

// MARK: - Auth View
struct AuthView: View {
    @EnvironmentObject var authManager: AuthManager
    @State private var email = ""
    @State private var password = ""
    @State private var username = ""
    @State private var isRegister = false

    var body: some View {
        ZStack {
            Color(red: 7/255, green: 7/255, blue: 13/255)
                .ignoresSafeArea()

            StarsView()

            VStack(spacing: 30) {
                VStack(spacing: 8) {
                    Text("NEMESIS")
                        .font(.system(size: 42, weight: .black))
                        .foregroundColor(.white)

                    Text(":3")
                        .font(.system(size: 24))
                        .foregroundColor(Color(red: 108/255, green: 99/255, blue: 255/255))
                }
                .padding(.top, 40)

                VStack(spacing: 16) {
                    Text(isRegister ? "СОЗДАЙТЕ АККАУНТ" : "ВХОД")
                        .font(.headline)
                        .foregroundColor(.white)

                    if isRegister {
                        TextField("Имя пользователя", text: $username)
                            .textFieldStyle(CustomTextFieldStyle())
                            .autocapitalization(.none)
                    }

                    TextField("Email", text: $email)
                        .textFieldStyle(CustomTextFieldStyle())
                        .autocapitalization(.none)
                        .keyboardType(.emailAddress)

                    SecureField("Пароль", text: $password)
                        .textFieldStyle(CustomTextFieldStyle())

                    Button(action: handleAuth) {
                        if authManager.isLoading {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle(tint: .white))
                        } else {
                            Text(isRegister ? "ЗАРЕГИСТРИРОВАТЬСЯ" : "ВОЙТИ")
                                .font(.headline)
                                .foregroundColor(.white)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(
                        LinearGradient(
                            colors: [Color(red: 108/255, green: 99/255, blue: 255/255),
                                    Color(red: 167/255, green: 139/255, blue: 250/255)],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .cornerRadius(12)
                    .disabled(authManager.isLoading)

                    Button(action: { withAnimation { isRegister.toggle() } }) {
                        Text(isRegister ? "Уже есть аккаунт? Войти" : "Нет аккаунта? Зарегистрироваться")
                            .font(.subheadline)
                            .foregroundColor(Color(red: 136/255, green: 136/255, blue: 170/255))
                    }

                    if let error = authManager.errorMessage {
                        Text(error)
                            .font(.caption)
                            .foregroundColor(.red)
                            .multilineTextAlignment(.center)
                    }
                }
                .padding(.horizontal, 30)

                Spacer()
            }
        }
    }

    func handleAuth() {
        authManager.errorMessage = nil

        if isRegister {
            guard username.count >= 3 else {
                authManager.errorMessage = "❌ Имя не менее 3 символов"
                return
            }
            guard password.count >= 6 else {
                authManager.errorMessage = "❌ Пароль не менее 6 символов"
                return
            }
            authManager.signUp(email: email, password: password, username: username) { _ in }
        } else {
            authManager.signIn(email: email, password: password) { _ in }
        }
    }
}

// MARK: - Main Tab View (Главная / Профиль / Настройки)
struct MainTabView: View {
    @EnvironmentObject var authManager: AuthManager
    @StateObject private var chatManager = ChatManager()

    var body: some View {
        TabView {
            ChatHomeView()
                .environmentObject(chatManager)
                .tabItem { Label("Главная", systemImage: "message.fill") }

            ProfileView()
                .environmentObject(chatManager)
                .tabItem { Label("Профиль", systemImage: "person.fill") }

            SettingsView()
                .tabItem { Label("Настройки", systemImage: "gearshape.fill") }
        }
        .accentColor(Color(red: 108/255, green: 99/255, blue: 255/255))
        .onAppear {
            if let uid = authManager.currentUser?.uid {
                chatManager.attach(uid: uid)
            }
        }
        .onChange(of: authManager.currentUser?.uid) { uid in
            if let uid = uid {
                chatManager.attach(uid: uid)
            } else {
                chatManager.detach()
            }
        }
    }
}

// MARK: - Chat Home View (главная = сам чат, как у других ИИ-приложений)
struct ChatHomeView: View {
    @EnvironmentObject var authManager: AuthManager
    @EnvironmentObject var chatManager: ChatManager

    @State private var inputText = ""
    @State private var showChatList = false
    @State private var selectedPhotoItem: PhotosPickerItem?
    @State private var selectedImage: UIImage?

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 8) {
                            if chatManager.messages.isEmpty {
                                VStack(spacing: 10) {
                                    Spacer(minLength: 80)
                                    Text("🤖")
                                        .font(.system(size: 40))
                                    Text("Начните разговор с Nemesis AI")
                                        .foregroundColor(Color(red: 85/255, green: 85/255, blue: 102/255))
                                    Spacer()
                                }
                                .frame(maxWidth: .infinity)
                            }

                            ForEach(chatManager.messages) { message in
                                MessageBubble(message: message)
                                    .id(message.id)
                                    .transition(.asymmetric(
                                        insertion: .move(edge: .bottom).combined(with: .opacity),
                                        removal: .opacity
                                    ))
                            }
                        }
                        .padding()
                    }
                    .onChange(of: chatManager.messages.count) { _ in
                        withAnimation {
                            proxy.scrollTo(chatManager.messages.last?.id, anchor: .bottom)
                        }
                    }
                }

                if let image = selectedImage {
                    HStack {
                        Image(uiImage: image)
                            .resizable()
                            .scaledToFill()
                            .frame(width: 44, height: 44)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                        Text("Фото прикреплено")
                            .font(.caption)
                            .foregroundColor(Color(red: 136/255, green: 136/255, blue: 170/255))
                        Spacer()
                        Button(action: { withAnimation { selectedImage = nil; selectedPhotoItem = nil } }) {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundColor(Color(red: 255/255, green: 68/255, blue: 68/255))
                        }
                    }
                    .padding(.horizontal)
                    .padding(.vertical, 6)
                }

                HStack(spacing: 12) {
                    PhotosPicker(selection: $selectedPhotoItem, matching: .images) {
                        Image(systemName: "paperclip")
                            .font(.title3)
                            .foregroundColor(Color(red: 136/255, green: 136/255, blue: 170/255))
                            .frame(width: 40, height: 40)
                            .background(Color(red: 255/255, green: 255/255, blue: 255/255).opacity(0.05))
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                    .disabled(chatManager.isUploadingPhoto)

                    TextField("Напиши сообщение...", text: $inputText)
                        .textFieldStyle(CustomTextFieldStyle())
                        .disabled(chatManager.isSending)

                    Button(action: sendMessage) {
                        if chatManager.isSending || chatManager.isUploadingPhoto {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                .frame(width: 44, height: 44)
                        } else {
                            Image(systemName: "paperplane.fill")
                                .font(.title2)
                                .foregroundColor(.white)
                                .frame(width: 44, height: 44)
                                .background(
                                    LinearGradient(
                                        colors: (!inputText.trimmingCharacters(in: .whitespaces).isEmpty || selectedImage != nil)
                                            ? [Color(red: 108/255, green: 99/255, blue: 255/255), Color(red: 167/255, green: 139/255, blue: 250/255)]
                                            : [Color.gray.opacity(0.3), Color.gray.opacity(0.3)],
                                        startPoint: .topLeading, endPoint: .bottomTrailing
                                    )
                                )
                                .cornerRadius(12)
                        }
                    }
                    .disabled((inputText.trimmingCharacters(in: .whitespaces).isEmpty && selectedImage == nil) || chatManager.isSending || chatManager.isUploadingPhoto)
                }
                .padding(.horizontal)
                .padding(.bottom, 8)
                .padding(.top, 6)
            }
            .background(Color(red: 7/255, green: 7/255, blue: 13/255))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button(action: { showChatList = true }) {
                        Image(systemName: "list.bullet")
                            .foregroundColor(.white)
                    }
                }
                ToolbarItem(placement: .principal) {
                    Text(chatManager.chats.first(where: { $0.id == chatManager.currentChatId })?.title ?? "Nemesis AI")
                        .font(.headline)
                        .foregroundColor(.white)
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { chatManager.createNewChat() }) {
                        Image(systemName: "square.and.pencil")
                            .foregroundColor(.white)
                    }
                }
            }
            .sheet(isPresented: $showChatList) {
                ChatListSheet()
                    .environmentObject(chatManager)
            }
            .onChange(of: selectedPhotoItem) { newItem in
                Task {
                    if let data = try? await newItem?.loadTransferable(type: Data.self),
                       let uiImage = UIImage(data: data) {
                        await MainActor.run {
                            withAnimation { selectedImage = uiImage }
                        }
                    }
                }
            }
        }
    }

    func sendMessage() {
        guard let role = authManager.currentUser?.role else { return }
        if chatManager.currentChatId == nil {
            chatManager.createNewChat()
        }
        chatManager.sendMessage(text: inputText, image: selectedImage, role: role)
        inputText = ""
        withAnimation {
            selectedImage = nil
            selectedPhotoItem = nil
        }
    }
}

// MARK: - Chat List Sheet (выбор / создание / удаление чатов)
struct ChatListSheet: View {
    @EnvironmentObject var chatManager: ChatManager
    @Environment(\.dismiss) var dismiss

    var body: some View {
        NavigationView {
            List {
                ForEach(chatManager.chats) { chat in
                    Button(action: {
                        chatManager.selectChat(chat.id)
                        dismiss()
                    }) {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(chat.title)
                                    .foregroundColor(.white)
                                    .fontWeight(chat.id == chatManager.currentChatId ? .semibold : .regular)
                                Text("\(chat.messages.count) сообщений")
                                    .font(.caption)
                                    .foregroundColor(Color(red: 136/255, green: 136/255, blue: 170/255))
                            }
                            Spacer()
                            if chat.id == chatManager.currentChatId {
                                Image(systemName: "checkmark")
                                    .foregroundColor(Color(red: 108/255, green: 99/255, blue: 255/255))
                            }
                        }
                    }
                    .listRowBackground(Color(red: 255/255, green: 255/255, blue: 255/255).opacity(0.03))
                }
                .onDelete { indices in
                    indices.forEach { idx in
                        chatManager.deleteChat(chatManager.chats[idx].id)
                    }
                }
            }
            .listStyle(.plain)
            .background(Color(red: 7/255, green: 7/255, blue: 13/255))
            .hiddenScrollBackground()
            .navigationTitle("Мои чаты")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Закрыть") { dismiss() }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: {
                        chatManager.createNewChat()
                        dismiss()
                    }) {
                        Image(systemName: "plus")
                    }
                }
            }
        }
        .preferredColorScheme(.dark)
    }
}

// MARK: - Typing Dots (анимированный индикатор "печатает")
struct TypingDotsView: View {
    @State private var animate = false

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<3) { i in
                Circle()
                    .fill(Color(red: 108/255, green: 99/255, blue: 255/255))
                    .frame(width: 6, height: 6)
                    .offset(y: animate ? -4 : 0)
                    .animation(
                        Animation.easeInOut(duration: 0.5)
                            .repeatForever()
                            .delay(Double(i) * 0.15),
                        value: animate
                    )
            }
        }
        .onAppear { animate = true }
    }
}

// MARK: - Message Bubble
struct MessageBubble: View {
    let message: Message

    var body: some View {
        HStack {
            if message.role == .user {
                Spacer()
            }

            VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 4) {
                if message.role == .assistant {
                    Text("Nemesis AI")
                        .font(.caption)
                        .foregroundColor(Color(red: 108/255, green: 99/255, blue: 255/255))
                        .fontWeight(.semibold)
                }

                if let imageUrlString = message.imageUrl, let url = URL(string: imageUrlString) {
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case .success(let image):
                            image.resizable().scaledToFit()
                        case .failure:
                            Color.gray.opacity(0.2)
                        default:
                            ProgressView()
                        }
                    }
                    .frame(maxWidth: 220, maxHeight: 220)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }

                if message.content.isEmpty && message.role == .assistant {
                    HStack(spacing: 6) {
                        TypingDotsView()
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .background(Color(red: 255/255, green: 255/255, blue: 255/255).opacity(0.05))
                    .cornerRadius(12)
                } else if !message.content.isEmpty {
                    Text(message.content)
                        .font(.body)
                        .foregroundColor(.white)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(
                            message.role == .user ?
                            Color(red: 108/255, green: 99/255, blue: 255/255).opacity(0.15) :
                            Color(red: 255/255, green: 255/255, blue: 255/255).opacity(0.05)
                        )
                        .cornerRadius(12)
                }
            }

            if message.role == .assistant {
                Spacer()
            }
        }
        .padding(.horizontal, 4)
    }
}

// MARK: - Profile View
struct ProfileView: View {
    @EnvironmentObject var authManager: AuthManager
    @EnvironmentObject var chatManager: ChatManager
    @State private var showKeyAlert = false
    @State private var generatedKey = ""

    var body: some View {
        NavigationView {
            VStack(spacing: 24) {
                if let user = authManager.currentUser {
                    Circle()
                        .fill(
                            LinearGradient(
                                colors: [user.role.color, user.role.color.opacity(0.6)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .frame(width: 80, height: 80)
                        .overlay(
                            Text(String(user.username.prefix(1).uppercased()))
                                .font(.title)
                                .fontWeight(.bold)
                                .foregroundColor(.white)
                        )

                    Text(user.username)
                        .font(.title2)
                        .fontWeight(.bold)
                        .foregroundColor(.white)

                    Text(user.email)
                        .font(.subheadline)
                        .foregroundColor(Color(red: 136/255, green: 136/255, blue: 170/255))

                    Text(user.role.displayName)
                        .font(.headline)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 6)
                        .background(user.role.color.opacity(0.15))
                        .foregroundColor(user.role.color)
                        .cornerRadius(20)

                    HStack(spacing: 30) {
                        VStack {
                            Text("\(user.role.maxTokens)")
                                .font(.title2)
                                .fontWeight(.bold)
                                .foregroundColor(.white)
                            Text("Токенов")
                                .font(.caption)
                                .foregroundColor(Color(red: 136/255, green: 136/255, blue: 170/255))
                        }

                        VStack {
                            Text("\(chatManager.chats.count)")
                                .font(.title2)
                                .fontWeight(.bold)
                                .foregroundColor(.white)
                            Text("Чатов")
                                .font(.caption)
                                .foregroundColor(Color(red: 136/255, green: 136/255, blue: 170/255))
                        }
                    }
                    .padding()
                    .background(Color(red: 255/255, green: 255/255, blue: 255/255).opacity(0.025))
                    .cornerRadius(16)

                    if user.role.canGenerateKeys {
                        Button(action: generateKey) {
                            HStack {
                                Image(systemName: "key.fill")
                                Text("Сгенерировать ключ")
                            }
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(Color.yellow.opacity(0.1))
                            .foregroundColor(.yellow)
                            .cornerRadius(12)
                        }
                        .padding(.horizontal)
                    }

                    Button(action: {
                        authManager.signOut()
                    }) {
                        HStack {
                            Image(systemName: "rectangle.portrait.and.arrow.right")
                            Text("Выйти")
                        }
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color(red: 255/255, green: 68/255, blue: 68/255).opacity(0.1))
                        .foregroundColor(Color(red: 255/255, green: 68/255, blue: 68/255))
                        .cornerRadius(12)
                    }
                    .padding(.horizontal)
                }

                Spacer()
            }
            .padding(.top, 40)
            .background(Color(red: 7/255, green: 7/255, blue: 13/255))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text("Профиль")
                        .font(.headline)
                        .foregroundColor(.white)
                }
            }
        }
        .alert("👑 Новый ключ", isPresented: $showKeyAlert) {
            Button("Скопировать") {
                UIPasteboard.general.string = generatedKey
            }
            Button("Закрыть", role: .cancel) { }
        } message: {
            Text(generatedKey)
        }
    }

    func generateKey() {
        let key = "NEM-" + UUID().uuidString.prefix(8).uppercased() + "-" + UUID().uuidString.prefix(6).uppercased()
        generatedKey = key
        showKeyAlert = true
    }
}

// MARK: - Settings View
struct SettingsView: View {
    @EnvironmentObject var authManager: AuthManager
    @AppStorage("nemesis_font_size") private var fontSize: Double = 16
    @State private var activateKeyInput = ""
    @State private var activateStatus = ""
    @State private var isActivating = false

    var body: some View {
        NavigationView {
            Form {
                Section(header: Text("Внешний вид").foregroundColor(Color(red: 136/255, green: 136/255, blue: 170/255))) {
                    HStack {
                        Text("Размер текста")
                        Spacer()
                        Stepper(value: $fontSize, in: 12...24, step: 2) {
                            Text("\(Int(fontSize))")
                        }
                    }
                }

                Section(header: Text("Подписка").foregroundColor(Color(red: 136/255, green: 136/255, blue: 170/255))) {
                    HStack {
                        TextField("Введите ключ...", text: $activateKeyInput)
                            .autocapitalization(.allCharacters)
                        Button(isActivating ? "⏳" : "Активировать") {
                            activateKey()
                        }
                        .disabled(isActivating || activateKeyInput.isEmpty)
                    }
                    if !activateStatus.isEmpty {
                        Text(activateStatus)
                            .font(.caption)
                            .foregroundColor(activateStatus.contains("✅") ? .green : .red)
                    }
                }

                Section(header: Text("О приложении").foregroundColor(Color(red: 136/255, green: 136/255, blue: 170/255))) {
                    HStack { Text("Версия"); Spacer(); Text("2.1.0").foregroundColor(.gray) }
                    HStack { Text("Команда"); Spacer(); Text("Kotik Team").foregroundColor(.gray) }
                    HStack { Text("Поддержка"); Spacer(); Text("@Nemesissup").foregroundColor(.gray) }
                }
            }
            .hiddenScrollBackground()
            .background(Color(red: 7/255, green: 7/255, blue: 13/255))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text("Настройки")
                        .font(.headline)
                        .foregroundColor(.white)
                }
            }
        }
    }

    func activateKey() {
        guard !activateKeyInput.isEmpty else { return }
        isActivating = true
        authManager.activateKey(key: activateKeyInput.uppercased()) { success in
            isActivating = false
            if success {
                activateStatus = "✅ Роль обновлена!"
                activateKeyInput = ""
            } else {
                activateStatus = authManager.errorMessage ?? "❌ Ошибка активации"
            }
        }
    }
}
