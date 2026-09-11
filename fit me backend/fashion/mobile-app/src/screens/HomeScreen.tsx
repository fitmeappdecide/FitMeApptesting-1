import { View, Text } from "react-native";
import UniversalSearchBar from "../components/UniversalSearchBar";
export default function HomeScreen() { return <View style={{ flex: 1, backgroundColor: "#1A1208", padding: 20 }}><Text style={{ color: "#C9974A", letterSpacing: 1.2 }}>UNIVERSAL TRY-ON</Text><Text style={{ color: "white", fontSize: 36, fontWeight: "700", marginVertical: 16 }}>Try any product from any platform</Text><UniversalSearchBar /></View>; }
