class Candidate {
  const Candidate({
    required this.id,
    required this.fullName,
    required this.nationality,
    required this.opportunity,
    required this.status,
    required this.createdAt,
    this.passportNumber,
    this.phone,
    this.email,
  });

  final String id;
  final String fullName;
  final String nationality;
  final String opportunity;
  final String status;
  final DateTime createdAt;
  final String? passportNumber;
  final String? phone;
  final String? email;

  factory Candidate.fromJson(Map<String, dynamic> json) => Candidate(
        id: json['id'] as String,
        fullName: json['fullName'] as String,
        nationality: json['nationality'] as String,
        opportunity: json['opportunity'] as String,
        status: json['status'] as String,
        createdAt: DateTime.parse(json['createdAt'] as String),
        passportNumber: json['passportNumber'] as String?,
        phone: json['phone'] as String?,
        email: json['email'] as String?,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'fullName': fullName,
        'nationality': nationality,
        'opportunity': opportunity,
        'status': status,
        'createdAt': createdAt.toIso8601String(),
        if (passportNumber != null) 'passportNumber': passportNumber,
        if (phone != null) 'phone': phone,
        if (email != null) 'email': email,
      };
}
