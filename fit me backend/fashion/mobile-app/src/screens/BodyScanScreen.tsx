import { View } from "react-native";
import PhotoSlot from "../components/PhotoSlot";
import TryOnButton from "../components/TryOnButton";
export default function BodyScanScreen() { return <View style={{ flex: 1, gap: 12, backgroundColor: "#1A1208", padding: 20 }}><PhotoSlot label="Front photo" /><PhotoSlot label="Back photo" /><PhotoSlot label="Left side" /><PhotoSlot label="Right side" /><TryOnButton title="Generate Try-On" /></View>; }
