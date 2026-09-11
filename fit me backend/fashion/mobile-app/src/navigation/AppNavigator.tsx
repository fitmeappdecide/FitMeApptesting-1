import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { NavigationContainer } from "@react-navigation/native";
import HomeScreen from "../screens/HomeScreen";
import BodyScanScreen from "../screens/BodyScanScreen";
import TryOnResultScreen from "../screens/TryOnResultScreen";
const Stack = createNativeStackNavigator();
export default function AppNavigator() { return <NavigationContainer><Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: "#1A1208" }, headerTintColor: "#FFFFFF", contentStyle: { backgroundColor: "#1A1208" } }}><Stack.Screen name="Home" component={HomeScreen} /><Stack.Screen name="BodyScan" component={BodyScanScreen} /><Stack.Screen name="Result" component={TryOnResultScreen} /></Stack.Navigator></NavigationContainer>; }
