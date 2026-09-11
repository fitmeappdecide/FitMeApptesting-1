import { Text, Pressable } from "react-native";
export default function TryOnButton({ title = "Try On Me" }: { title?: string }) { return <Pressable style={{ backgroundColor: "#A0392B", borderRadius: 28, padding: 16 }}><Text style={{ color: "white", textAlign: "center", fontWeight: "700" }}>{title}</Text></Pressable>; }
