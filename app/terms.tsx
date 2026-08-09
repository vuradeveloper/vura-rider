import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";

export default function TermsScreen() {
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
          Terms of Service
        </Text>
        <Text className="text-sm text-white/80 mt-1">
          Please read these terms carefully
        </Text>
      </View>

      <ScrollView className="flex-1 px-5 mt-6" showsVerticalScrollIndicator={false}>
        <Text className="text-xs font-bold text-muted-foreground uppercase mb-4">
          Last updated: July 2026
        </Text>

        <Section title="1. Acceptance of Terms">
          By accessing or using the Vura Ride application, you agree to be bound by these Terms
          of Service. If you do not agree to all the terms, you may not use the service.
        </Section>

        <Section title="2. Description of Service">
          Vura Ride provides a platform connecting riders with drivers for transportation services.
          We facilitate the booking and payment process but are not a transportation carrier.
        </Section>

        <Section title="3. User Accounts">
          You must create an account to use our services. You are responsible for maintaining the
          confidentiality of your account credentials and for all activities under your account.
        </Section>

        <Section title="4. Rider Responsibilities">
          As a rider, you agree to: provide accurate pickup and drop-off locations, treat drivers
          with respect, pay all applicable fares, and not engage in illegal activities during rides.
        </Section>

        <Section title="5. Driver Responsibilities">
          As a driver, you agree to: maintain a valid driver's license and vehicle registration,
          provide safe and reliable service, follow all traffic laws, and treat riders with respect.
        </Section>

        <Section title="6. Payments and Fees">
          All fares are calculated based on distance and time. Payment is processed through our
          secure payment system. Drivers are paid according to their agreed-upon commission structure.
        </Section>

        <Section title="7. Cancellations">
          Riders may cancel a ride before the driver arrives. Repeated cancellations may result
          in account restrictions. Drivers may cancel in accordance with our cancellation policy.
        </Section>

        <Section title="8. Limitation of Liability">
          Vura Ride shall not be liable for any indirect, incidental, or consequential damages
          arising from the use of our services. Our total liability is limited to the amount paid
          for the specific ride in question.
        </Section>

        <Section title="9. Termination">
          We reserve the right to suspend or terminate accounts that violate these terms,
          engage in fraudulent activity, or harm other users of the platform.
        </Section>

        <Section title="10. Changes to Terms">
          We may update these terms at any time. Continued use of the service after changes
          constitutes acceptance of the new terms. We will notify you of material changes.
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
