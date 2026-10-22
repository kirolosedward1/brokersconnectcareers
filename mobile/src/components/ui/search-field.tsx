import { useState } from 'react';
import { Pressable, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslations } from 'use-intl';
import { appDirection } from '~/lib/direction';
import { useTheme } from '~/theme/provider';
import { corner, font, hitTarget, space, type as scale } from '~/theme/tokens';
import { Search, X } from './lucide';

/** As long as the website lets a search be (its parsers cut the words at 120). */
const MAX_WORDS = 120;

/**
 * A list's search field, at the top of the screen: what is typed runs in the
 * app's direction — in Arabic from the right, the magnifier at the right — and
 * is searched with the keyboard's Search key; the clear mark empties the field
 * and the search with it.
 *
 * In place of iOS's own search bar, which iOS lays out by the phone's language
 * rather than the app's: on an iPhone set to English, and in Expo Go, it ran
 * left to right under the Arabic, and iOS 26 moved it to the foot of the screen.
 *
 * It shows `value` whichever way that changes — typed here, carried in a link,
 * or dropped with its chip — and keeps what is being typed until then.
 */
export function SearchField({
  value,
  label,
  placeholder,
  onSearch,
  style,
}: {
  value: string;
  /** What VoiceOver calls the field. */
  label: string;
  placeholder: string;
  /** The words, trimmed and cut to the website's length; '' once cleared. */
  onSearch: (words: string) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTranslations();
  const { colors, scheme } = useTheme();
  const [text, setText] = useState(value);
  const [shown, setShown] = useState(value);
  const [focused, setFocused] = useState(false);

  // The search changed from elsewhere: the field says so.
  if (value !== shown) {
    setShown(value);
    setText(value);
  }

  const clear = () => {
    setText('');
    if (value) onSearch('');
  };

  return (
    <View
      style={[
        {
          minHeight: hitTarget,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space[2],
          paddingStart: space[3] + 2,
          ...corner('full'),
          borderWidth: 1,
          borderColor: focused ? colors.primary : colors.border,
          backgroundColor: colors.card,
        },
        style,
      ]}
    >
      <Search size={18} color={colors.mutedForeground} />
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        accessibilityLabel={label}
        returnKeyType="search"
        enterKeyHint="search"
        autoCapitalize="none"
        autoCorrect={false}
        selectionColor={colors.primary}
        keyboardAppearance={scheme}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onSubmitEditing={() => onSearch(text.trim().slice(0, MAX_WORDS))}
        style={{
          flex: 1,
          minHeight: hitTarget,
          fontFamily: font.regular,
          fontSize: scale.body.fontSize,
          color: colors.foreground,
          // The physical edge: React Native does not mirror a field's alignment (text-field.tsx).
          textAlign: appDirection === 'rtl' ? 'right' : 'left',
          paddingVertical: 0,
        }}
      />
      {text ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('app.search.clear')}
          onPress={clear}
          style={{ width: hitTarget, height: hitTarget, alignItems: 'center', justifyContent: 'center' }}
        >
          <View style={{ width: 20, height: 20, ...corner('full'), alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted }}>
            <X size={12} color={colors.mutedForeground} strokeWidth={2.5} />
          </View>
        </Pressable>
      ) : (
        <View style={{ width: space[3] }} />
      )}
    </View>
  );
}
