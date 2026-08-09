import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/lib/auth";

export default function TabLayout() {
  const { user } = useAuth();
  const isDriver = user?.role === "driver";

  const riderTabs = [
    { name: "index", title: "Home", icon: "home" as const },
    { name: "activity", title: "Activity", icon: "receipt" as const },
    { name: "account", title: "Account", icon: "person" as const },
  ];

  const driverTabs = [
    { name: "index", title: "Drive", icon: "car" as const },
    { name: "activity", title: "Trips", icon: "bar-chart" as const },
    { name: "account", title: "Account", icon: "person" as const },
  ];

  const tabs = isDriver ? driverTabs : riderTabs;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#e04e2f",
        tabBarInactiveTintColor: "#80716b",
        tabBarStyle: {
          borderTopWidth: 1,
          borderTopColor: "#ebe3de",
          backgroundColor: "#ffffff",
          paddingTop: 8,
          paddingBottom: 24,
          height: 70,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600",
          marginTop: -4,
        },
      }}
    >
      <Tabs.Screen
        name="services"
        options={{
          href: null,
        }}
      />
      {tabs.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarIcon: ({ color, focused }) => (
              <Ionicons
                name={tab.icon}
                size={focused ? 20 : 22}
                color={color}
                style={
                  focused
                    ? {
                        backgroundColor: "#e04e2f",
                        color: "#ffffff",
                        padding: 6,
                        borderRadius: 8,
                        marginTop: -20,
                        overflow: "visible",
                      }
                    : undefined
                }
              />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
