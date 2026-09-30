<!-- backend.md §1e — 색인: ../backend.md -->
## 1e. 이메일 회원가입 인증 (커스텀 SMTP + OTP 템플릿)

> 이메일/비밀번호로 가입하면 Supabase 기본 설정은 **확인 메일**을 보내고, 앱은
> 확인 단계에서 **6자리 코드(OTP)** 를 입력받아 `auth.verifyOtp(..., 'signup')`으로
> 검증한다(`features/auth/VerifyStep.tsx`). 그런데 두 가지 기본값이 이 흐름을
> 막는다: ① Supabase **기본 메일 발송은 시간당 수 통 제한 + 스팸 분류**라 실제로
> 잘 도착하지 않고, ② 기본 "Confirm signup" 템플릿은 **매직링크(`{{ .ConfirmationURL }}`)**
> 만 담아 6자리 코드가 메일에 없다. 아래 두 가지를 설정해야 가입 인증이 동작한다.

### ① 커스텀 SMTP 연결 (메일이 실제로 도착하게)

대시보드 → **Project Settings → Authentication → SMTP Settings** → *Enable Custom SMTP*.
발송 서비스는 아무거나 되지만 [Resend](https://resend.com)가 무료 티어(월 3,000통) +
연동이 쉬워 권장:

1. Resend 가입 → **도메인 인증**: Resend → *Domains* → Add `geurio.com` → 화면이
   보여주는 **SPF·DKIM 레코드를 Vercel DNS에 그대로 추가**(Vercel → 프로젝트 →
   Settings → Domains → geurio.com → DNS Records). 인증되면 `no-reply@geurio.com`
   발신 가능. (도메인 없이 테스트만이면 `onboarding@resend.dev` 발신도 되지만
   프로덕션은 도메인 인증 필수 — 안 하면 스팸 분류/거부된다.)
2. **DMARC 추가**(프로덕션 필수 — Gmail/Yahoo가 요구). Vercel DNS에 TXT:
   ```
   Name: _dmarc     Value: v=DMARC1; p=none; rua=mailto:dmarc@geurio.com
   ```
   며칠 정상 도착 확인 후 `p=none` → `p=quarantine`으로 조인다.
3. Resend → **API Keys**에서 키 발급.
4. Supabase SMTP Settings에 입력:
   - Host `smtp.resend.com`, Port `465`(SSL) 또는 `587`(STARTTLS)
   - Username `resend`, Password = **Resend API 키**
   - Sender email `no-reply@geurio.com`(인증된 도메인), Sender name `Geurio`
5. (선택) Authentication → Rate Limits에서 이메일 발송 한도를 필요에 맞게 상향.

> **왜 Gmail/Workspace SMTP가 아니라 Resend인가**: 구글 메일(무료 Gmail·Workspace)은
> 사람이 쓰는 메일함이지 앱 자동발송용이 아니다 — 딜리버리(스팸)·발송 한도·발신 주소
> (무료 Gmail은 `@gmail.com`만)·ToS(자동발송 제한) 모두 프로덕션에 불리하다. Resend는
> 트랜잭션 메일 전용이라 이 용도에 최적.

> Resend API 키는 **비밀값** — Supabase 대시보드에만 입력하고 저장소·커밋·클라이언트에
> 절대 넣지 않는다(`service_role`/Client Secret과 동일 취급).

### ② 이메일 템플릿을 코드(OTP) 방식으로 교체 (앱의 입력과 일치)

앱은 매직링크가 아니라 **6자리 코드(OTP)** 를 입력받으므로, **두 템플릿 모두** `{{ .Token }}`을
써야 한다. 대시보드 → **Authentication → Emails**.

> ⚠️ **기본 템플릿에 "추가"하지 말고 본문 전체를 교체**할 것. Supabase 기본 템플릿은
> 영문 안내 + 매직링크(`{{ .ConfirmationURL }}`)라, 코드 줄만 덧붙이면 영문 문구·링크가
> 남아 지저분하고 흐름도 뒤섞인다(우리는 코드 입력 방식). `{{ .ConfirmationURL }}`은
> 넣지 않는다. 쓰는 변수는 `{{ .Token }}` 하나면 충분. 코드 기본 만료는 1시간.
>
> 템플릿 HTML = 메일 본문 그 자체(Supabase가 주변 문구를 덧붙이지 않음).

**"Confirm signup"** — Subject: `Geurio 가입 인증 코드`
```html
<div style="font-family:'Apple SD Gothic Neo','Malgun Gothic',system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#33281f">
  <h1 style="font-size:20px;font-weight:800;margin:0 0 8px">Geurio 가입을 확인해 주세요</h1>
  <p style="font-size:14px;color:#8a7365;line-height:1.7;margin:0 0 24px">아래 6자리 인증 코드를 가입 화면에 입력하면 가입이 완료됩니다.</p>
  <div style="font-size:32px;font-weight:800;letter-spacing:8px;color:#f0663f;text-align:center;background:#fdeee7;border-radius:12px;padding:18px 0;margin:0 0 24px">{{ .Token }}</div>
  <p style="font-size:12.5px;color:#9c8b7e;line-height:1.7;margin:0">이 코드는 1시간 후 만료됩니다. 본인이 요청하지 않았다면 이 메일을 무시하세요.</p>
  <hr style="border:none;border-top:1px solid #ecdfd5;margin:28px 0 16px" />
  <p style="font-size:12px;color:#b6a596;margin:0">© Geurio (그리오)</p>
</div>
```

**"Reset Password"** — Subject: `Geurio 비밀번호 재설정 코드`
```html
<div style="font-family:'Apple SD Gothic Neo','Malgun Gothic',system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#33281f">
  <h1 style="font-size:20px;font-weight:800;margin:0 0 8px">비밀번호 재설정 코드</h1>
  <p style="font-size:14px;color:#8a7365;line-height:1.7;margin:0 0 24px">아래 6자리 코드를 비밀번호 찾기 화면에 입력하고 새 비밀번호를 설정하세요.</p>
  <div style="font-size:32px;font-weight:800;letter-spacing:8px;color:#f0663f;text-align:center;background:#fdeee7;border-radius:12px;padding:18px 0;margin:0 0 24px">{{ .Token }}</div>
  <p style="font-size:12.5px;color:#9c8b7e;line-height:1.7;margin:0">이 코드는 1시간 후 만료됩니다. 본인이 요청하지 않았다면 비밀번호는 그대로 유지되니 안심하세요.</p>
  <hr style="border:none;border-top:1px solid #ecdfd5;margin:28px 0 16px" />
  <p style="font-size:12px;color:#b6a596;margin:0">© Geurio (그리오)</p>
</div>
```

### ③ 앱 코드 쪽 (이미 구현됨 — 참고)

대시보드만 맞추면 되고 추가 작업은 없다. Supabase 모드에서:

- **회원가입 인증**: `verifyOtp(..., 'signup')`으로 코드 검증. "다시 보내기"는
  `auth.resend({ type: 'signup' })` 실제 호출.
- **비밀번호 찾기 인증**: 이메일의 코드로 `verifyOtp(..., 'recovery')` → 복구 세션 확립 →
  `updatePassword(새 비번)`. 성공 시 그대로 로그인 상태로 홈 이동. "다시 보내기"는
  `sendPasswordReset` 재발송(`features/auth/useLoginController.ts`의 `resetPw`/`resendCode`).
- 두 인증 화면 모두 **데모 코드 힌트 박스는 로컬/데모 모드에서만** 노출(Supabase 모드엔
  실제 메일 코드를 입력하므로 숨김).
- 로컬/데모 모드(env 미설정)에선 서버가 없어 화면의 데모 코드로 시뮬레이션한다.

### (대안) 인증을 아예 받지 않으려면

가장 간단: Authentication → Sign In / Providers → Email → **"Confirm email" 토글 OFF**.
그러면 가입 즉시 세션이 생기고 앱도 이를 그대로 처리한다(`signUp`의 `needsVerification`이
false가 되어 verify 단계를 건너뜀). 단 이메일 소유 확인은 안 된다.
