import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { apiFetch } from "./api";
import Constants from "expo-constants";

// Configure default notification presentation behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Request notification permissions and fetch the Expo Push Token.
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  let token: string | null = null;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#FF231F7C",
    });
  }

  // Check if it is a physical device
  const isDevice = Constants.isDevice ?? true;
  if (!isDevice) {
    console.log("Must use physical device for Push Notifications");
    return null;
  }

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== "granted") {
      console.log("Failed to get push token for push notification (permission not granted)");
      return null;
    }

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId ??
      "240a2b06-15df-4ff9-b21a-ceace1aa6c7a";

    token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    console.log("Expo Push Token obtained:", token);
  } catch (error) {
    console.error("Error getting Expo Push Token:", error);
  }

  return token;
}

/**
 * Send push token to the backend endpoint /api/notifications/register to link it to the authenticated user.
 */
export async function registerDeviceToken(token: string): Promise<boolean> {
  try {
    await apiFetch("/api/notifications/register", {
      method: "POST",
      body: JSON.stringify({ token, platform: Platform.OS }),
    });
    console.log("Device token successfully registered with backend");
    return true;
  } catch (error) {
    console.error("Failed to register device token with backend:", error);
    return false;
  }
}
