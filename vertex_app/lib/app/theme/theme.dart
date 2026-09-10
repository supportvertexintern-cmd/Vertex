import 'package:flutter/material.dart';

import 'colors.dart';
import 'typography.dart';

final vertexTheme = ThemeData(
  useMaterial3: true,
  brightness: Brightness.dark,
  scaffoldBackgroundColor: VertexColors.midnight950,
  colorScheme: const ColorScheme.dark(
    primary: VertexColors.midnight500,
    onPrimary: VertexColors.ivory50,
    secondary: VertexColors.gold400,
    onSecondary: VertexColors.midnight950,
    surface: VertexColors.midnight900,
    onSurface: VertexColors.ivory50,
    error: VertexColors.error,
    onError: VertexColors.ivory50,
  ),
  appBarTheme: AppBarTheme(backgroundColor: VertexColors.midnight950, foregroundColor: VertexColors.ivory50, elevation: 0, titleTextStyle: VertexTypography.h3),
  elevatedButtonTheme: ElevatedButtonThemeData(style: ElevatedButton.styleFrom(backgroundColor: VertexColors.gold400, foregroundColor: VertexColors.midnight950, minimumSize: const Size.fromHeight(52), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)), textStyle: VertexTypography.button, elevation: 0)),
  outlinedButtonTheme: OutlinedButtonThemeData(style: OutlinedButton.styleFrom(foregroundColor: VertexColors.ivory50, side: const BorderSide(color: VertexColors.midnight800), minimumSize: const Size.fromHeight(52), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)))),
  textButtonTheme: TextButtonThemeData(style: TextButton.styleFrom(foregroundColor: VertexColors.midnight500, textStyle: VertexTypography.label)),
  inputDecorationTheme: InputDecorationTheme(filled: true, fillColor: VertexColors.midnight900, contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16), border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: VertexColors.midnight800)), enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: VertexColors.midnight800)), focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: VertexColors.midnight500, width: 1.5)), errorBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: VertexColors.error)), labelStyle: VertexTypography.bodySmall, hintStyle: const TextStyle(color: VertexColors.gray400)),
  cardTheme: CardThemeData(color: VertexColors.midnight900, elevation: 0, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: const BorderSide(color: VertexColors.midnight800))),
  dividerTheme: const DividerThemeData(color: VertexColors.midnight800),
  progressIndicatorTheme: const ProgressIndicatorThemeData(color: VertexColors.midnight500),
);