import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";

type IoniconsName = ComponentProps<typeof Ionicons>["name"];

const iconMap: Record<string, IoniconsName> = {
  search: "search",
  clock: "time",
  home: "home",
  briefcase: "briefcase",
  car: "car",
  "utensils-crossed": "restaurant",
  package: "cube",
  bell: "notifications",
  compass: "compass",
  receipt: "receipt",
  user: "person",
  wallet: "wallet",
  "bar-chart-3": "bar-chart",
  star: "star",
  "refresh-cw": "refresh",
  "badge-check": "checkmark-circle",
  "shield-check": "shield-checkmark",
  "chevron-right": "chevron-forward",
  "arrow-left": "arrow-back",
  "chevron-left": "chevron-back",
  "log-out": "log-out",
  gift: "gift",
  shield: "shield",
  settings: "settings",
  "help-circle": "help-circle",
  map: "map",
  "map-pin": "location",
  circle: "ellipse",
  credit: "card",
  banknote: "cash",
  tag: "pricetag",
  x: "close",
  phone: "call",
  "message-circle": "chatbubble",
  share: "share",
  "alert-triangle": "warning",
  plus: "add",
  history: "time",
  trash2: "trash",
  save: "save",
  upload: "cloud-upload",
  "file-text": "document-text",
  "message-square": "chatbubbles",
  "alert-circle": "alert-circle",
  "key-round": "key",
  "bell-ring": "alarm",
  check: "checkmark",
  users: "people",
  crown: "diamond",
  zap: "flash",
  loader2: "sync",
  key: "key",
  mail: "mail",
  lock: "lock-closed",
  eye: "eye",
  "eye-off": "eye-off",
  plane: "airplane",
  bike: "bicycle",
  truck: "truck",
  calendar: "calendar",
  "chevron-down": "chevron-down",
  "credit-card": "card",
  "bars-3": "menu",
  menu: "menu",
  "arrow-up": "arrow-up",
  "arrow-down": "arrow-down",
  info: "information-circle",
  "more-horizontal": "ellipsis-horizontal",
  "more-vertical": "ellipsis-vertical",
  send: "send",
  camera: "camera",
  image: "image",
  mic: "mic",
  "mic-off": "mic-off",
  pause: "pause",
  play: "play",
  film: "film",
  book: "book",
  bookmark: "bookmark",
  cloud: "cloud",
  wifi: "wifi",
  "wifi-off": "wifi-off",
  infinity: "infinite",
  link: "link",
  smile: "happy",
};

interface IconProps {
  name: string;
  size?: number;
  color?: string;
  className?: string;
}

export function Icon({ name, size = 20, color, className }: IconProps) {
  const ionName = iconMap[name];
  if (!ionName) {
    return null;
  }
  return (
    <Ionicons
      name={ionName}
      size={size}
      color={color}
      style={className ? undefined : undefined}
    />
  );
}
