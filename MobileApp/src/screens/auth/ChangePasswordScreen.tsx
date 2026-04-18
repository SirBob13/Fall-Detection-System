import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Formik } from 'formik';
import * as Yup from 'yup';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { authService } from '../../services/auth.service';
import { useLanguage } from '../../components/LanguageProvider';
import type { SettingsStackParamList } from '../../navigation/AppNavigator';
import type { ChangePasswordData } from '../../types/auth';

type ChangePasswordNavigationProp = NativeStackNavigationProp<SettingsStackParamList, 'ChangePassword'>;

const ChangePasswordSchema = Yup.object().shape({
  current_password: Yup.string().required('Current password is required'),
  new_password: Yup.string()
    .min(8, 'Password must be at least 8 characters')
    .required('New password is required'),
  confirm_password: Yup.string()
    .oneOf([Yup.ref('new_password')], 'Passwords do not match')
    .required('Confirm password is required'),
});

export const ChangePasswordScreen: React.FC = () => {
  const navigation = useNavigation<ChangePasswordNavigationProp>();
  const { t } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const handleChangePassword = async (values: ChangePasswordData) => {
    try {
      setLoading(true);
      const response = await authService.changePassword(values);

      if (!response.success) {
        Alert.alert('Error', response.message || 'Failed to change password');
        return;
      }

      Alert.alert(
        'Success',
        'Password changed successfully. Please login again.',
        [
          {
            text: 'OK',
            onPress: () => {
              navigation.goBack();
            },
          },
        ]
      );
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, padding: 24 }}
          showsVerticalScrollIndicator={false}
        >
          <View className="items-center mb-10 mt-5">
            <View className="w-24 h-24 rounded-full bg-blue-50 justify-center items-center mb-6">
              <MaterialIcons name="lock-reset" size={48} color="#2196F3" />
            </View>
            <Text className="text-2xl font-bold text-dark text-center mb-3">
              {t('settings.changePassword')}
            </Text>
            <Text className="text-base text-gray text-center leading-6 max-w-xs">
              {t('settings.changePasswordHint')}
            </Text>
          </View>

          <Formik<ChangePasswordData>
            initialValues={{
              current_password: '',
              new_password: '',
              confirm_password: '',
            }}
            validationSchema={ChangePasswordSchema}
            onSubmit={handleChangePassword}
          >
            {({
              handleChange,
              handleBlur,
              handleSubmit,
              values,
              errors,
              touched,
              isValid,
              dirty,
            }) => (
              <View className="mb-8">
                <View className="mb-5">
                  <Text className="text-base font-semibold text-dark mb-2">
                    {t('settings.currentPassword')}
                  </Text>
                  <View className="relative">
                    <TextInput
                      className={`input-field pr-12 ${errors.current_password && touched.current_password ? 'border-danger' : ''}`}
                      placeholder="••••••••"
                      placeholderTextColor="#BDBDBD"
                      value={values.current_password}
                      onChangeText={handleChange('current_password')}
                      onBlur={handleBlur('current_password')}
                      secureTextEntry={!showCurrentPassword}
                      editable={!loading}
                    />
                    <TouchableOpacity
                      className="absolute right-4 top-4"
                      onPress={() => setShowCurrentPassword((prev) => !prev)}
                      activeOpacity={0.7}
                    >
                      <MaterialIcons
                        name={showCurrentPassword ? 'visibility-off' : 'visibility'}
                        size={22}
                        color="#666"
                      />
                    </TouchableOpacity>
                  </View>
                  {errors.current_password && touched.current_password ? (
                    <Text className="error-text">{errors.current_password}</Text>
                  ) : null}
                </View>

                <View className="mb-5">
                  <Text className="text-base font-semibold text-dark mb-2">
                    {t('settings.newPassword')}
                  </Text>
                  <View className="relative">
                    <TextInput
                      className={`input-field pr-12 ${errors.new_password && touched.new_password ? 'border-danger' : ''}`}
                      placeholder="••••••••"
                      placeholderTextColor="#BDBDBD"
                      value={values.new_password}
                      onChangeText={handleChange('new_password')}
                      onBlur={handleBlur('new_password')}
                      secureTextEntry={!showNewPassword}
                      editable={!loading}
                    />
                    <TouchableOpacity
                      className="absolute right-4 top-4"
                      onPress={() => setShowNewPassword((prev) => !prev)}
                      activeOpacity={0.7}
                    >
                      <MaterialIcons
                        name={showNewPassword ? 'visibility-off' : 'visibility'}
                        size={22}
                        color="#666"
                      />
                    </TouchableOpacity>
                  </View>
                  {errors.new_password && touched.new_password ? (
                    <Text className="error-text">{errors.new_password}</Text>
                  ) : null}
                </View>

                <View className="mb-8">
                  <Text className="text-base font-semibold text-dark mb-2">
                    {t('settings.confirmPassword')}
                  </Text>
                  <View className="relative">
                    <TextInput
                      className={`input-field pr-12 ${errors.confirm_password && touched.confirm_password ? 'border-danger' : ''}`}
                      placeholder="••••••••"
                      placeholderTextColor="#BDBDBD"
                      value={values.confirm_password}
                      onChangeText={handleChange('confirm_password')}
                      onBlur={handleBlur('confirm_password')}
                      secureTextEntry={!showConfirmPassword}
                      editable={!loading}
                    />
                    <TouchableOpacity
                      className="absolute right-4 top-4"
                      onPress={() => setShowConfirmPassword((prev) => !prev)}
                      activeOpacity={0.7}
                    >
                      <MaterialIcons
                        name={showConfirmPassword ? 'visibility-off' : 'visibility'}
                        size={22}
                        color="#666"
                      />
                    </TouchableOpacity>
                  </View>
                  {errors.confirm_password && touched.confirm_password ? (
                    <Text className="error-text">{errors.confirm_password}</Text>
                  ) : null}
                </View>

                <TouchableOpacity
                  className={`btn-primary flex-row justify-center items-center py-4 ${(!isValid || !dirty || loading) ? 'opacity-50' : ''}`}
                  onPress={() => handleSubmit()}
                  disabled={!isValid || !dirty || loading}
                  activeOpacity={0.7}
                >
                  {loading ? (
                    <ActivityIndicator color="#FFF" size="small" />
                  ) : (
                    <>
                      <MaterialIcons name="lock-reset" size={22} color="#FFF" />
                      <Text className="text-white font-bold text-lg ml-3">
                        {t('settings.changePassword')}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </Formik>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

export default ChangePasswordScreen;
