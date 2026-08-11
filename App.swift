//
//  App.swift
//  NemesisAI
//
//  Created by Kotik Team
//

import SwiftUI
import Firebase
import FirebaseAuth
import FirebaseDatabase

// MARK: - App Delegate
class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey : Any]? = nil) -> Bool {
        
        // 👇 Firebase конфигурация БЕЗ GoogleService-Info.plist
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

struct Message: Identifiable {
    let id = UUID()
    let role: MessageRole
    var content: String
    let imageUrl: String?
    let timestamp: TimeInterval
    
    enum MessageRole {
        case user
        case assistant
        case system
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
                    
                    if isRegister {
                        SecureField("Повторите пароль", text: .constant(""))
                            .textFieldStyle(CustomTextFieldStyle())
                    }
                    
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
                    
                    Button(action: { isRegister.toggle() }) {
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
            authManager.signUp(email: email, password: password, username: username) { success in
                if !success {}
            }
        } else {
            authManager.signIn(email: email, password: password) { success in
                if !success {}
            }
        }
    }
}

// MARK: - Main Tab View
struct MainTabView: View {
    @EnvironmentObject var authManager: AuthManager
    
    var body: some View {
        TabView {
            HomeView()
                .tabItem {
                    Label("Главная", systemImage: "house.fill")
                }
            
            ChatView()
                .tabItem {
                    Label("Чат", systemImage: "message.fill")
                }
            
            ProfileView()
                .tabItem {
                    Label("Профиль", systemImage: "person.fill")
                }
        }
        .accentColor(Color(red: 108/255, green: 99/255, blue: 255/255))
        .background(Color(red: 7/255, green: 7/255, blue: 13/255))
    }
}

// MARK: - Home View
struct HomeView: View {
    @EnvironmentObject var authManager: AuthManager
    @State private var keyInput = ""
    @State private var keyStatus = ""
    
    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 30) {
                    VStack(spacing: 12) {
                        Text("NEMESIS :3")
                            .font(.system(size: 44, weight: .black))
                            .foregroundColor(.white)
                        
                        Text("Экосистема продуктов для оптимизации, игр и искусственного интеллекта")
                            .font(.subheadline)
                            .foregroundColor(Color(red: 136/255, green: 136/255, blue: 170/255))
                            .multilineTextAlignment(.center)
                            .padding(.horizontal)
                    }
                    .padding(.top, 20)
                    
                    VStack(spacing: 16) {
                        Text("ПРОДУКТЫ")
                            .font(.title2)
                            .fontWeight(.bold)
                            .foregroundColor(.white)
                        
                        HStack(spacing: 16) {
                            ProductCard(
                                icon: "🖥️",
                                title: "Nemesis Steam",
                                description: "Лаунчер + оптимизация",
                                tag: "FREE / ELITE"
                            )
                            
                            ProductCard(
                                icon: "🤖",
                                title: "Nemesis AI",
                                description: "ИИ-помощник для любых задач",
                                tag: "AI+ / AI MAX",
                                isPremium: true
                            )
                        }
                        .padding(.horizontal)
                    }
                    
                    VStack(spacing: 16) {
                        Text("ВЫБЕРИ ТАРИФ")
                            .font(.title2)
                            .fontWeight(.bold)
                            .foregroundColor(.white)
                        
                        VStack(spacing: 12) {
                            TariffCard(
                                title: "FREE",
                                price: "0 ₽",
                                features: ["Steam (база)", "Прицел", "Утилиты"],
                                isActive: authManager.currentUser?.role == .free
                            )
                            
                            TariffCard(
                                title: "ELITE",
                                price: "199 ₽",
                                features: ["Steam (полная)", "Всё из FREE", "Приоритет"],
                                badge: "🔥 ПОПУЛЯРНЫЙ",
                                isActive: authManager.currentUser?.role == .elite
                            )
                            
                            TariffCard(
                                title: "AI+",
                                price: "99 ₽",
                                features: ["ИИ (полный)", "Экспорт диалогов", "Приоритет"],
                                isActive: authManager.currentUser?.role == .aiBasic
                            )
                            
                            TariffCard(
                                title: "AI MAX",
                                price: "299 ₽",
                                features: ["Steam + ИИ", "Всё из ELITE и AI+", "Эксклюзив"],
                                badge: "👑 ВСЁ ВКЛЮЧЕНО",
                                isActive: authManager.currentUser?.role == .aiMax
                            )
                            
                            TariffCard(
                                title: "LYNX",
                                price: "🐆",
                                features: ["Эксклюзивный доступ", "Ранний доступ к фичам", "Особый статус"],
                                badge: "🐆 ОСОБЫЙ",
                                isActive: authManager.currentUser?.role == .lynx,
                                role: .lynx
                            )
                        }
                        .padding(.horizontal)
                    }
                    
                    VStack(spacing: 12) {
                        Text("🎁 Есть ключ? Активируй!")
                            .font(.headline)
                            .foregroundColor(.white)
                        
                        HStack {
                            TextField("Введите ключ...", text: $keyInput)
                                .textFieldStyle(CustomTextFieldStyle())
                                .autocapitalization(.allCharacters)
                            
                            Button("Активировать") {
                                activateKey()
                            }
                            .padding(.horizontal, 16)
                            .padding(.vertical, 12)
                            .background(Color(red: 108/255, green: 99/255, blue: 255/255))
                            .cornerRadius(12)
                            .foregroundColor(.white)
                            .font(.headline)
                        }
                        .padding(.horizontal)
                        
                        Text(keyStatus)
                            .font(.caption)
                            .foregroundColor(keyStatus.contains("✅") ? .green : .red)
                    }
                    .padding()
                    .background(Color(red: 255/255, green: 255/255, blue: 255/255).opacity(0.025))
                    .cornerRadius(20)
                    .padding(.horizontal)
                }
                .padding(.vertical)
            }
            .background(Color(red: 7/255, green: 7/255, blue: 13/255))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text("NEMESIS")
                        .font(.headline)
                        .foregroundColor(.white)
                }
            }
        }
    }
    
    func activateKey() {
        guard !keyInput.isEmpty else {
            keyStatus = "❌ Введите ключ"
            return
        }
        
        authManager.activateKey(key: keyInput.uppercased()) { success in
            if success {
                keyStatus = "✅ Роль обновлена!"
                keyInput = ""
            } else {
                keyStatus = authManager.errorMessage ?? "❌ Ошибка активации"
            }
        }
    }
}

// MARK: - Product Card
struct ProductCard: View {
    let icon: String
    let title: String
    let description: String
    let tag: String
    var isPremium: Bool = false
    
    var body: some View {
        VStack(spacing: 12) {
            Text(icon)
                .font(.system(size: 48))
            
            Text(title)
                .font(.headline)
                .foregroundColor(.white)
            
            Text(description)
                .font(.caption)
                .foregroundColor(Color(red: 136/255, green: 136/255, blue: 170/255))
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            
            Text(tag)
                .font(.caption2)
                .fontWeight(.semibold)
                .padding(.horizontal, 12)
                .padding(.vertical, 4)
                .background(
                    isPremium ?
                    Color(red: 255/255, green: 215/255, blue: 0/255).opacity(0.1) :
                    Color(red: 108/255, green: 99/255, blue: 255/255).opacity(0.15)
                )
                .foregroundColor(isPremium ? .yellow : Color(red: 108/255, green: 99/255, blue: 255/255))
                .cornerRadius(20)
        }
        .padding()
        .frame(maxWidth: .infinity)
        .background(Color(red: 255/255, green: 255/255, blue: 255/255).opacity(0.025))
        .cornerRadius(20)
        .overlay(
            RoundedRectangle(cornerRadius: 20)
                .stroke(Color(red: 255/255, green: 255/255, blue: 255/255).opacity(0.05), lineWidth: 1)
        )
    }
}

// MARK: - Tariff Card
struct TariffCard: View {
    let title: String
    let price: String
    let features: [String]
    var badge: String? = nil
    var isActive: Bool = false
    var role: UserRole? = nil
    
    var roleColor: Color {
        role?.color ?? Color(red: 108/255, green: 99/255, blue: 255/255)
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading) {
                    Text(title)
                        .font(.headline)
                        .foregroundColor(.white)
                    
                    Text(price)
                        .font(.title2)
                        .fontWeight(.bold)
                        .foregroundColor(.white)
                }
                
                Spacer()
                
                if let badge = badge {
                    Text(badge)
                        .font(.caption2)
                        .fontWeight(.bold)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 4)
                        .background(roleColor.opacity(0.2))
                        .foregroundColor(roleColor)
                        .cornerRadius(20)
                }
                
                if isActive {
                    Text("✅ АКТИВЕН")
                        .font(.caption2)
                        .fontWeight(.bold)
                        .foregroundColor(.green)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 4)
                        .background(Color.green.opacity(0.1))
                        .cornerRadius(20)
                }
            }
            
            ForEach(features, id: \.self) { feature in
                HStack {
                    Text("✦")
                        .foregroundColor(roleColor)
                    Text(feature)
                        .font(.subheadline)
                        .foregroundColor(Color(red: 170/255, green: 170/255, blue: 204/255))
                }
            }
        }
        .padding()
        .background(Color(red: 255/255, green: 255/255, blue: 255/255).opacity(0.025))
        .cornerRadius(16)
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(
                    isActive ? roleColor.opacity(0.4) :
                    (role == .lynx ? Color(red: 0/255, green: 200/255, blue: 255/255).opacity(0.2) :
                    Color(red: 255/255, green: 255/255, blue: 255/255).opacity(0.05)),
                    lineWidth: role == .lynx ? 2 : 1
                )
        )
    }
}

// MARK: - Chat View
struct ChatView: View {
    @EnvironmentObject var authManager: AuthManager
    @State private var messages: [Message] = []
    @State private var inputText = ""
    @State private var isSending = false
    
    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 8) {
                            if messages.isEmpty {
                                VStack {
                                    Spacer()
                                    Text("Начните чат с Nemesis AI")
                                        .foregroundColor(Color(red: 85/255, green: 85/255, blue: 102/255))
                                        .padding()
                                    Spacer()
                                }
                                .frame(maxHeight: .infinity)
                            }
                            
                            ForEach(messages) { message in
                                MessageBubble(message: message)
                                    .id(message.id)
                            }
                        }
                        .padding()
                    }
                    .onChange(of: messages.count) { _ in
                        withAnimation {
                            proxy.scrollTo(messages.last?.id, anchor: .bottom)
                        }
                    }
                }
                
                VStack(spacing: 8) {
                    HStack(spacing: 12) {
                        TextField("Напиши сообщение...", text: $inputText)
                            .textFieldStyle(CustomTextFieldStyle())
                            .disabled(isSending)
                        
                        Button(action: sendMessage) {
                            if isSending {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                    .frame(width: 44, height: 44)
                            } else {
                                Image(systemName: "paperplane.fill")
                                    .font(.title2)
                                    .foregroundColor(.white)
                                    .frame(width: 44, height: 44)
                                    .background(
                                        !inputText.isEmpty ?
                                        Color(red: 108/255, green: 99/255, blue: 255/255) :
                                        Color.gray.opacity(0.3)
                                    )
                                    .cornerRadius(12)
                            }
                        }
                        .disabled(inputText.isEmpty || isSending)
                    }
                    .padding(.horizontal)
                    .padding(.bottom, 8)
                }
                .background(Color(red: 7/255, green: 7/255, blue: 13/255))
            }
            .background(Color(red: 7/255, green: 7/255, blue: 13/255))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text("Nemesis AI")
                        .font(.headline)
                        .foregroundColor(.white)
                }
            }
        }
    }
    
    func sendMessage() {
        guard !inputText.isEmpty, !isSending else { return }
        let userMessage = Message(role: .user, content: inputText, imageUrl: nil, timestamp: Date().timeIntervalSince1970)
        messages.append(userMessage)
        inputText = ""
        isSending = true
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            let assistantMessage = Message(
                role: .assistant,
                content: "Это тестовый ответ от Nemesis AI. В реальном приложении здесь будет ответ от нейросети! 😊",
                imageUrl: nil,
                timestamp: Date().timeIntervalSince1970
            )
            messages.append(assistantMessage)
            isSending = false
        }
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
                            Text("0")
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
