import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// Configure notification behavior when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Requests push / local notification permissions from the user.
 * On iOS, this triggers the native system alert: "FitMe Would Like to Send You Notifications".
 */
export async function requestNotificationPermissions(): Promise<boolean> {
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: true,
          allowSound: true,
        },
      });
      finalStatus = status;
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'FitMe Notifications',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#C49A45',
      });
    }

    return finalStatus === 'granted';
  } catch (error) {
    console.warn('[NotificationService] Error requesting permissions:', error);
    return false;
  }
}

/**
 * Triggers an immediate notification when a try-on completes.
 * If user has navigated away or locked their phone, this displays on the lock screen / notification banner.
 */
export async function sendTryOnReadyNotification(productTitle?: string) {
  try {
    const titleText = productTitle && productTitle !== 'Virtual Look'
      ? `✨ Your try-on for "${productTitle}" is ready!`
      : '✨ Your new FitMe look is ready!';

    await Notifications.scheduleNotificationAsync({
      content: {
        title: titleText,
        body: 'Tap to view your look on yourself.',
        sound: true,
      },
      trigger: null, // deliver immediately
    });
  } catch (error) {
    console.warn('[NotificationService] Error sending try-on ready notification:', error);
  }
}
