// CGN 주차 앱 Firebase 설정
// Firebase 콘솔 > 프로젝트 설정 > 내 앱(웹)에 나오는 값을 그대로 붙여 넣으세요.
var FIREBASE_CONFIG = {
  apiKey:            "AIzaSyBYk4aP561YHCnDcOXqkpHIM1RGWheTU6A",
  authDomain:        "cgn-parking.firebaseapp.com",
  databaseURL:       "https://cgn-parking-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId:         "cgn-parking",
  storageBucket:     "cgn-parking.firebasestorage.app",
  messagingSenderId: "991841963976",
  appId:             "1:991841963976:web:2b589ba0dbc0798f083afd"
};

// 가입을 허용할 회사 이메일 도메인 (database.rules.json 의 값과 같아야 합니다)
var ALLOWED_EMAIL_DOMAIN = "@cgnmail.net";

// 마스터 관리자 — 모든 권한을 갖고, 다른 관리자를 지정할 수 있습니다
// MASTER_EMAIL 은 database.rules.json 의 값과 같아야 합니다
var MASTER_EMAIL = "cgn210@cgnmail.net";
var MASTER_NAME  = "주웅현";
