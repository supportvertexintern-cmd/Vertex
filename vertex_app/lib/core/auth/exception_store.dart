import 'package:flutter/foundation.dart';

enum ExceptionStatus { open, decidedClosed }

class CorrectiveAction {
  final String description;
  CorrectiveAction({required this.description});
}

class RecruiterException {
  final String id;
  final String reference;
  final String type;
  final String crmRef;
  final String issueStatement;
  final String immediateImpact;
  final String actionsTaken;
  final String rootCause;
  final String optionsConsidered;
  final String recommendation;
  final String decisionRequired;
  final DateTime? targetDate;
  final List<CorrectiveAction> correctiveActions;
  final ExceptionStatus status;
  final DateTime createdAt;

  RecruiterException({
    required this.id,
    required this.reference,
    required this.type,
    required this.crmRef,
    required this.issueStatement,
    required this.immediateImpact,
    required this.actionsTaken,
    required this.rootCause,
    required this.optionsConsidered,
    required this.recommendation,
    required this.decisionRequired,
    this.targetDate,
    this.correctiveActions = const [],
    this.status = ExceptionStatus.open,
    required this.createdAt,
  });
}

class ExceptionStore extends ChangeNotifier {
  final List<RecruiterException> _exceptions = [];

  List<RecruiterException> get openExceptions =>
      _exceptions.where((e) => e.status == ExceptionStatus.open).toList();

  List<RecruiterException> get closedExceptions =>
      _exceptions.where((e) => e.status == ExceptionStatus.decidedClosed).toList();

  void add(RecruiterException exception) {
    _exceptions.insert(0, exception);
    notifyListeners();
  }
}
