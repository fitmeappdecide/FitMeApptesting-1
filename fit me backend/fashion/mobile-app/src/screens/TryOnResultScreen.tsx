import { View } from "react-native";
import FitAnalysisCard from "../components/FitAnalysisCard";
import PriceComparisonCard from "../components/PriceComparisonCard";
export default function TryOnResultScreen() { return <View style={{ flex: 1, gap: 16, backgroundColor: "#1A1208", padding: 20 }}><FitAnalysisCard /><PriceComparisonCard /></View>; }
