import { Stack } from "expo-router";

export default function AffiliateLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }} initialRouteName="index">
      <Stack.Screen name="index" />
      <Stack.Screen name="referrals" />
      <Stack.Screen name="transactions" />
    </Stack>
  );
}