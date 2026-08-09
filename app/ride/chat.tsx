import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { getSocket } from "@/lib/socket";
import type { TypedSocket } from "@/lib/socket";
import type { ChatMessage } from "@/lib/types";

export default function ChatScreen() {
  const { rideId, driverName, driverVehicle, driverPlate } = useLocalSearchParams<{
    rideId: string;
    driverName?: string;
    driverVehicle?: string;
    driverPlate?: string;
  }>();
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [connected, setConnected] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    let socket: TypedSocket | null = null;
    (async () => {
      try {
        socket = await getSocket();
        socket.emit("chat:join", { rideId });

        socket.on("chat:message", (msg: ChatMessage) => {
          setMessages((prev) => [...prev, msg]);
        });

        socket.on("chat:history", (history: ChatMessage[]) => {
          setMessages(history);
        });

        setConnected(true);
      } catch {
        // socket connection failed
      }
    })();

    return () => {
      if (socket) {
        socket.emit("chat:leave", { rideId });
        socket.off("chat:message");
        socket.off("chat:history");
      }
      setMessages([]);
    };
  }, [rideId]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || !rideId) return;
    setInput("");
    try {
      const socket = await getSocket();
      socket.emit("chat:send", { rideId, message: text });
    } catch {
      // ignore
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-row items-center gap-3 px-5 py-3 border-b border-border bg-surface">
        <TouchableOpacity
          onPress={() => router.back()}
          className="w-9 h-9 rounded-full bg-secondary items-center justify-center"
        >
          <Ionicons name="arrow-back" size={16} color="#2e1e1a" />
        </TouchableOpacity>
        <View className="flex-1">
          <Text className="text-sm font-bold text-foreground">
            {driverName || "Driver"}
          </Text>
          {(driverVehicle || driverPlate) && (
            <Text className="text-xs text-muted-foreground">
              {[driverVehicle, driverPlate].filter(Boolean).join(" · ")}
            </Text>
          )}
        </View>
        {!connected && (
          <ActivityIndicator size="small" color="#e04e2f" />
        )}
      </View>

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerClassName="px-4 py-4 gap-y-2"
          onContentSizeChange={() =>
            flatListRef.current?.scrollToEnd({ animated: true })
          }
          renderItem={({ item }) => {
            const isMe = item.sender_role === "rider";
            return (
              <View
                className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
                  isMe
                    ? "bg-primary self-end rounded-br-sm"
                    : "bg-secondary self-start rounded-bl-sm"
                }`}
              >
                <Text
                  className={`text-sm ${
                    isMe ? "text-primary-foreground" : "text-foreground"
                  }`}
                >
                  {item.message}
                </Text>
                <Text
                  className={`text-[10px] mt-1 ${
                    isMe ? "text-primary-foreground/60" : "text-muted-foreground"
                  }`}
                >
                  {new Date(item.created_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Text>
              </View>
            );
          }}
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center pt-20">
              <Ionicons name="chatbubbles" size={40} color="#80716b" />
              <Text className="text-sm text-muted-foreground mt-3">
                Send a message to your driver
              </Text>
            </View>
          }
        />

        <View className="flex-row items-center gap-2 px-4 py-3 border-t border-border bg-surface">
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Type a message..."
            placeholderTextColor="#80716b"
            className="flex-1 rounded-full bg-secondary px-4 py-2.5 text-sm font-medium text-foreground"
            multiline={false}
            onSubmitEditing={sendMessage}
          />
          <TouchableOpacity
            onPress={sendMessage}
            disabled={!input.trim()}
            className={`w-10 h-10 rounded-full items-center justify-center ${
              input.trim() ? "bg-primary" : "bg-secondary"
            }`}
          >
            <Ionicons
              name="send"
              size={16}
              color={input.trim() ? "#fff" : "#80716b"}
            />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
