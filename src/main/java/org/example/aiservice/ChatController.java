package org.example.aiservice;

import jakarta.servlet.http.HttpSession;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.*;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Flux;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api")
@CrossOrigin // 允许跨域
public class ChatController {

    @Autowired
    private RestTemplate restTemplate;

    @Autowired
    private ChatLogRepository chatLogRepository;

    @Autowired
    private UserRepository userRepository;

    private final WebClient webClient = WebClient.builder()
            .baseUrl("http://127.0.0.1:8000")
            .build();

    // ==========================================
    //  1. 用户认证模块
    // ==========================================

    @PostMapping("/register")
    public Map<String, Object> register(@RequestBody Map<String, String> body) {
        String username = body.get("username");
        String password = body.get("password");

        if (userRepository.findByUsername(username) != null) {
            return Map.of("success", false, "message", "用户名已存在");
        }

        User newUser = new User();
        newUser.setUsername(username);
        newUser.setPassword(password);
        userRepository.save(newUser);

        return Map.of("success", true, "message", "注册成功");
    }

    @PostMapping("/login")
    public Map<String, Object> login(@RequestBody Map<String, String> body) {
        String username = body.get("username");
        String password = body.get("password");

        User user = userRepository.findByUsername(username);

        if (user != null && user.getPassword().equals(password)) {
            Map<String, Object> response = new HashMap<>();
            response.put("success", true);
            response.put("userId", user.getId());
            response.put("username", user.getUsername());
            return response;
        } else {
            return Map.of("success", false, "message", "用户名或密码错误");
        }
    }

    @PostMapping("/logout")
    public Map<String, Object> logout(HttpSession session) {
        session.invalidate();
        return Map.of("success", true, "message", "注销成功");
    }

    // ==========================================
    //  2. 历史记录模块
    // ==========================================

    @GetMapping("/history")
    public List<ChatLog> getHistory(@RequestParam(required = false) Long userId) {
        if (userId == null) return Collections.emptyList();
        return chatLogRepository.findTop50ByUserIdOrderByCreatedAtDesc(userId);
    }

    @DeleteMapping("/history/{id}")
    public Map<String, Object> deleteHistory(@PathVariable Long id) {
        try {
            chatLogRepository.deleteById(id);
            return Map.of("success", true, "message", "删除成功");
        } catch (Exception e) {
            return Map.of("success", false, "message", "删除失败");
        }
    }

    // ==========================================
    //  3. 核心 AI 问答模块 (逻辑修复版)
    // ==========================================

    @PostMapping(value = "/ask", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<String> askAi(@RequestBody Map<String, Object> request, HttpSession session) {

        // --- Step 1: 身份判断 ---
        Object userIdObj = request.get("userId");
        Long userId = null;
        boolean isGuest = true;

        if (userIdObj != null) {
            String uidStr = userIdObj.toString();
            if (!"guest".equals(uidStr) && !"undefined".equals(uidStr) && !uidStr.isEmpty()) {
                try {
                    userId = Long.valueOf(uidStr);
                    isGuest = false;
                } catch (NumberFormatException e) {}
            }
        }

        // --- Step 2: 游客限制 ---
        Boolean enableRag = (Boolean) request.get("enable_rag");
        if (isGuest && Boolean.TRUE.equals(enableRag)) {
            return Flux.just("data: ⚠️ **功能受限**\n\ndata: RAG功能暂不对游客用户开放。\n\n");
        }

        if (isGuest) {
            Integer count = (Integer) session.getAttribute("guest_ask_count");
            if (count == null) count = 0;
            if (count >= 3) {
                return Flux.just("data: ⛔ **试用结束**\n\ndata: 游客只能提问 3 次。\n\n");
            }
            session.setAttribute("guest_ask_count", count + 1);
        }

        // --- Step 3: 保存用户提问 ---
        if (!isGuest && userId != null) {
            try {
                ChatLog userLog = new ChatLog();
                userLog.setUserId(userId);
                userLog.setRole("user");
                userLog.setContent((String) request.get("question"));
                chatLogRepository.save(userLog);
            } catch (Exception e) {
                System.err.println("用户日志保存失败: " + e.getMessage());
            }
        }

        request.put("userId", isGuest ? "guest" : userId.toString());

        // --- Step 4: 转发请求并保存 AI 回答 ---

        StringBuilder aiResponseAccumulator = new StringBuilder();
        final Long finalUserId = userId;
        final boolean finalIsGuest = isGuest;

        return webClient.post()
                .uri("/ai/chat")
                .bodyValue(request)
                .retrieve()
                .bodyToFlux(String.class)
                .doOnNext(chunk -> aiResponseAccumulator.append(chunk))
                .doOnComplete(() -> {
                    if (!finalIsGuest && finalUserId != null) {
                        try {
                            String rawData = aiResponseAccumulator.toString();
                            StringBuilder cleanContent = new StringBuilder();

                            // 🚀【最终修正】混合解析逻辑
                            // 不管有没有 data: 前缀，我们都处理
                            String[] lines = rawData.split("\n");

                            for (String line : lines) {
                                // 1. 去掉首尾空白
                                line = line.trim();

                                // 2. 如果有 "data:" 前缀，去掉它
                                if (line.startsWith("data:")) {
                                    line = line.substring(5);
                                }

                                // 3. 再次确保去掉 "data:" 后面可能存在的空格
                                if (line.startsWith(" ")) {
                                    line = line.substring(1);
                                }

                                // 4. 把该行拼接到结果中
                                cleanContent.append(line);
                            }

                            // 5. 【关键】最后统一把字面量的 "\n" 变成真正的换行符
                            // 这样无论它藏在哪里，都会被修复，且不会影响保存逻辑
                            String finalContent = cleanContent.toString().replace("\\n", "\n");

                            // 6. 只要有内容就保存
                            if (!finalContent.isEmpty()) {
                                ChatLog aiLog = new ChatLog();
                                aiLog.setUserId(finalUserId);
                                aiLog.setRole("model");
                                aiLog.setContent(finalContent);
                                chatLogRepository.saveAndFlush(aiLog); // 强制保存
                                System.out.println("✅ AI回答已保存 (修正版)");
                            } else {
                                System.err.println("⚠️ 警告: 解析后内容仍为空，原始数据: " + rawData);
                            }

                        } catch (Exception e) {
                            e.printStackTrace();
                        }
                    }
                })
                .onErrorResume(e -> Flux.just("data: **系统错误**: " + e.getMessage() + "\n\n"));
    }

    // ==========================================
    //  4. 知识库模块
    // ==========================================

    @PostMapping("/upload")
    public Map<String, Object> uploadFile(@RequestParam("file") MultipartFile file,
                                          @RequestParam(value = "userId", required = false) String userId) {
        if (userId == null || "guest".equals(userId) || "undefined".equals(userId)) {
            return Map.of("error", "游客暂不支持上传文档，请先登录。");
        }

        if (file.isEmpty()) return Map.of("error", "文件为空");

        try {
            String uploadDir = System.getProperty("user.dir") + File.separator + "temp_uploads";
            File dir = new File(uploadDir);
            if (!dir.exists()) dir.mkdirs();

            Path filePath = Paths.get(uploadDir, file.getOriginalFilename());
            Files.write(filePath, file.getBytes());

            String pythonUrl = "http://127.0.0.1:8000/ai/upload";
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);

            MultiValueMap<String, String> map = new LinkedMultiValueMap<>();
            map.add("file_path", filePath.toAbsolutePath().toString());
            map.add("user_id", userId);

            HttpEntity<MultiValueMap<String, String>> entity = new HttpEntity<>(map, headers);
            return restTemplate.postForObject(pythonUrl, entity, Map.class);

        } catch (Exception e) {
            return Map.of("error", "上传失败: " + e.getMessage());
        }
    }

    @PostMapping("/reset")
    public Map<String, Object> resetKnowledgeBase() {
        return restTemplate.postForObject("http://127.0.0.1:8000/ai/reset", null, Map.class);
    }
}