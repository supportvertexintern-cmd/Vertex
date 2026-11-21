import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'landing_defaults.g.dart';

/// The home screen's text (the landing CMS, part 4): what marketing
/// published, block by block, over the built-in text.
///
/// It starts on the built-in text (landing_defaults.g.dart, exported from
/// vertex_be), then the answer it last saved, so the screen is never blank
/// and works offline; then it asks the web app (GET /api/public/landing,
/// which reads FastAPI) and saves a good answer for next time. A block the
/// answer doesn't send, one in a newer format than this app knows, or no
/// answer at all keeps the text it has. A block marketing hid is null.
class LandingStore extends ChangeNotifier {
  LandingStore(this._api);

  final LandingApi _api;

  static const cacheKey = 'landing.mobile';

  /// The bodies' format this app renders (vertex_be BLOCK_VERSION).
  static final int blockVersion = _defaults['version'] as int;

  /// Each block's body by key; null where marketing hid it.
  Map<String, Map<String, dynamic>?> blocks = builtIn();

  static final Map<String, dynamic> _defaults = jsonDecode(landingDefaultsJson) as Map<String, dynamic>;

  static Map<String, Map<String, dynamic>?> builtIn() => {
        for (final entry in (_defaults['blocks'] as Map<String, dynamic>).entries) entry.key: entry.value as Map<String, dynamic>,
      };

  /// [answer] ({version, blocks: [{key, visible, body}]}) over the built-in text.
  static Map<String, Map<String, dynamic>?> merge(Object? answer) {
    final out = builtIn();
    if (answer is! Map || answer['version'] != blockVersion || answer['blocks'] is! List) return out;
    for (final block in answer['blocks'] as List) {
      if (block is! Map) continue;
      final key = block['key'];
      if (key is! String || !out.containsKey(key)) continue;
      if (block['visible'] == false) {
        out[key] = null;
      } else if (block['body'] is Map) {
        out[key] = Map<String, dynamic>.from(block['body'] as Map);
      }
    }
    return out;
  }

  Future<void> load() async {
    SharedPreferences? preferences;
    try {
      preferences = await SharedPreferences.getInstance();
      final saved = preferences.getString(cacheKey);
      if (saved != null) {
        blocks = merge(jsonDecode(saved));
        notifyListeners();
      }
    } catch (_) {
      // A bad or unreadable copy: the built-in text stays.
    }
    final answer = await _api.mobile();
    if (answer == null) return;
    blocks = merge(answer);
    notifyListeners();
    try {
      await preferences?.setString(cacheKey, jsonEncode(answer));
    } catch (_) {}
  }
}

/// The web app's public read of the home screen's blocks.
class LandingApi {
  LandingApi({required String baseUrl, Dio? dio})
      : _dio = dio ?? Dio(BaseOptions(baseUrl: baseUrl, connectTimeout: const Duration(seconds: 5), receiveTimeout: const Duration(seconds: 8))) {
    // A failure is read from the status, not thrown.
    _dio.options.validateStatus = (_) => true;
  }

  final Dio _dio;

  /// FastAPI's answer ({app, version, blocks}), or null when there is none.
  Future<Map<String, dynamic>?> mobile() async {
    try {
      final res = await _dio.get<Map<String, dynamic>>('/api/public/landing', queryParameters: {'app': 'mobile'});
      final data = res.statusCode == 200 ? (res.data?['data']) : null;
      return data is Map<String, dynamic> ? data : null;
    } catch (_) {
      return null;
    }
  }
}
