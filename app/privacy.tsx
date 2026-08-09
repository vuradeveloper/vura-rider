import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";

export default function PrivacyScreen() {
  const router = useRouter();

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="bg-primary px-5 pt-4 pb-8 rounded-b-[2rem] relative">
        <TouchableOpacity
          onPress={() => router.back()}
          className="absolute top-4 left-4 w-9 h-9 rounded-full bg-white/20 items-center justify-center"
        >
          <Ionicons name="arrow-back" size={16} color="#fff" />
        </TouchableOpacity>
        <Text className="mt-12 text-2xl font-extrabold text-white">
          Privacy Policy
        </Text>
        <Text className="text-sm text-white/80 mt-1">
          How we handle your data
        </Text>
      </View>

      <ScrollView className="flex-1 px-5 mt-6" showsVerticalScrollIndicator={false}>
        <Text className="text-xs font-bold text-muted-foreground uppercase mb-4">
          Last updated: July 2026
        </Text>

        <Section title="1. Information We Collect">
          We collect information you provide directly, including your name, email address, phone
          number, and payment information. We also collect location data when you use our service
          to facilitate pickups and drop-offs.
        </Section>

        <Section title="2. How We Use Your Information">
          Your information is used to: provide and improve our ride-hailing services, process
          payments, communicate with you about your rides, ensure safety and security, and comply
          with legal obligations.
        </Section>

        <Section title="3. Location Data">
          We collect precise location data from your device when the app is in use. This is
          necessary to connect you with nearby drivers, calculate fares, and track rides. You
          can disable location services in your device settings.
        </Section>

        <Section title="4. Sharing of Information">
          We share your information with: drivers to facilitate pickups, payment processors for
          transactions, and law enforcement when required by law. We do not sell your personal
          information to third parties.
        </Section>

        <Section title="5. Data Security">
          We implement industry-standard security measures to protect your data, including
          encryption in transit and at rest. However, no method of electronic storage is 100%
          secure.
        </Section>

        <Section title="6. Your Rights">
          You have the right to: access your personal data, correct inaccurate data, delete your
          account and associated data, and opt out of marketing communications. Contact us to
          exercise these rights.
        </Section>

        <Section title="7. Data Retention">
          We retain your personal data for as long as your account is active and for a reasonable
          period thereafter to comply with legal obligations. You may request deletion of your
          data at any time.
        </Section>

        <Section title="8. Third-Party Services">
          Our app integrates with third-party services including Firebase Authentication, Google
          Maps, and payment processors. These services have their own privacy policies governing
          data handling.
        </Section>

        <Section title="9. Children's Privacy">
          Our services are not intended for users under the age of 18. We do not knowingly
          collect personal information from minors.
        </Section>

        <Section title="10. Contact Us">
          If you have questions about this Privacy Policy, please contact us through the Help
          section in the app or email support@vuraride.com.
        </Section>

        <View className="h-8" />
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mb-5">
      <Text className="text-base font-bold text-foreground mb-2">{title}</Text>
      <Text className="text-sm text-muted-foreground leading-5">{children}</Text>
    </View>
  );
}
