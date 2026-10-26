// The app's entry. Polyfills load before anything else so that formatters
// created at import time (the website's format.ts builds one) see a complete
// Intl, and supabase-js sees URL and WebCrypto.
import './src/lib/polyfills';
// Before the router reads window.location: a pasted listing must name its tab.
import './src/lib/web-entry-path';
import 'expo-router/entry';
