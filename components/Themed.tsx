import React from "react";
import {
  Text as RNText,
  View as RNView,
  useColorScheme,
  type TextProps,
  type ViewProps,
} from "react-native";

import Colors from "@/constants/Colors";

export function Text(props: TextProps) {
  const colorScheme = useColorScheme() ?? "light";
  const { style, ...otherProps } = props;

  return (
    <RNText
      style={[{ color: Colors[colorScheme as keyof typeof Colors].text }, style]}
      {...otherProps}
    />
  );
}

export function View(props: ViewProps) {
  const colorScheme = useColorScheme() ?? "light";
  const { style, ...otherProps } = props;

  return (
    <RNView
      style={[{ backgroundColor: Colors[colorScheme as keyof typeof Colors].background }, style]}
      {...otherProps}
    />
  );
}
