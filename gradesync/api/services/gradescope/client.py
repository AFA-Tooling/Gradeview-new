# https://pypi.org/project/fullGSapi/
from fullGSapi.api.client import GradescopeClient as GradescopeBaseClient
import threading
import requests
from requests.exceptions import Timeout, RequestException
from bs4 import BeautifulSoup

# 每个HTTP请求的超时时间（秒）
DEFAULT_REQUEST_TIMEOUT = 30  # 30秒，快速跳过卡住的作业
GRADESCOPE_ROOT = "https://www.gradescope.com"
GRADESCOPE_LOGIN_URL = f"{GRADESCOPE_ROOT}/login"

class GradescopeClient(GradescopeBaseClient):
    def __init__(self, timeout: int = 1800):
        """
        Initializes the extended fullGSapi Gradescope client with an inactivity timer.

        Parameters:
            timeout (int): Timeout in seconds for inactivity logout. Default is 1800 seconds (30 minutes).
        """
        super().__init__()  # Initialize the parent class (GradescopeBaseClient)
        self.timeout = timeout
        self.request_timeout = DEFAULT_REQUEST_TIMEOUT  # HTTP请求超时
        self.inactivity_timer = None
        self.lock = threading.Lock() # This is used for login synchronization

    def reset_inactivity_timer(self):
        """
        Resets or starts the inactivity timer for logging out the Gradescope client.

        Cancels any existing timer and starts a new one. When the timer expires, 
        it calls the `logout` method from this class to log out the client.

        Logout automatically if there are X minutes of inactivity for security reasons.
        """
        if self.inactivity_timer is not None:
            self.inactivity_timer.cancel()
        self.inactivity_timer = threading.Timer(self.timeout, self.logout)
        self.inactivity_timer.daemon = True
        self.inactivity_timer.start()
    
    def set_timer(self, newTimeout: int):
        """
        Set the timeout to the new timeout.
        """
        self.timeout = newTimeout
    
    def log_in(self, email: str, password: str) -> bool:
        """
        Logs into Gradescope. This overriden method is thread-safe.
        """
        if self.logged_in and self._session_is_authenticated():
            self.reset_inactivity_timer()
            return True

        with self.lock:  # Ensures only one thread can perform login at a time
            if self.logged_in and self._session_is_authenticated():
                self.reset_inactivity_timer()
                return True

            self.logged_in = False
            token = self._load_login_token(GRADESCOPE_LOGIN_URL)
            payload = {
                "utf8": "✓",
                "authenticity_token": token,
                "session[email]": email,
                "session[password]": password,
                "session[remember_me]": 1,
                "commit": "Log In",
                "session[remember_me_sso]": 0,
            }

            try:
                self.last_res = res = self.session.post(
                    GRADESCOPE_LOGIN_URL,
                    data=payload,
                    headers={
                        "Origin": GRADESCOPE_ROOT,
                        "Referer": GRADESCOPE_LOGIN_URL,
                    },
                    timeout=self.request_timeout,
                    # Following a redirect from gradescope.com to the canonical
                    # www host changes POST into GET and drops the credentials.
                    allow_redirects=False,
                )
            except (Timeout, RequestException) as exc:
                raise RuntimeError(f"Gradescope login request failed: {exc}") from exc

            if self._session_is_authenticated():
                self.logged_in = True
                self.reset_inactivity_timer()
                return True

            self.logged_in = False
            redirect = res.headers.get("Location", "")
            response_summary = f"HTTP {res.status_code}"
            if redirect:
                response_summary += f", redirect={redirect}"
            raise RuntimeError(
                "Failed to login to Gradescope "
                f"({response_summary}). Check the credentials and whether the "
                "account requires SSO, two-factor authentication, or CAPTCHA."
            )

    def _session_is_authenticated(self) -> bool:
        """Check the server-side session without consulting ``self.logged_in``."""
        try:
            self.last_res = res = self.session.get(
                GRADESCOPE_LOGIN_URL,
                timeout=self.request_timeout,
                allow_redirects=False,
            )
            # Gradescope rejects its login page with 401 for authenticated
            # sessions. fullGSapi checks the same response but first returns
            # False while self.logged_in is False, so it cannot verify a fresh
            # login before that local flag has been set.
            return res.status_code == 401
        except (Timeout, RequestException):
            return False

    def _extract_authenticity_token(self, content: bytes) -> str:
        soup = BeautifulSoup(content, "html.parser")
        form = soup.find("form")
        if not form:
            title = soup.title.string.strip() if soup.title and soup.title.string else "unknown page"
            raise RuntimeError(f"Gradescope login form not found; received {title}")
        token_input = form.find("input", {"name": "authenticity_token"})
        token = token_input.get("value") if token_input else None
        if not token:
            raise RuntimeError("Gradescope login form did not include an authenticity token")
        return token

    def _load_login_token(self, url: str) -> str:
        try:
            self.last_res = login_page = self.session.get(url, timeout=self.request_timeout)
            login_page.raise_for_status()
            return self._extract_authenticity_token(login_page.content)
        except Exception as exc:
            last_error = exc

        raise RuntimeError(
            "Failed to load Gradescope login token. "
            "Gradescope may be blocking password login, requiring SSO/2FA, "
            "or returning an unexpected login page."
        ) from last_error

    def logout(self):
        """
        Logs out of Gradescope. This overriden method is thread-safe.
        """
        with self.lock:  # Ensures only one thread can execute this block at a time
            # print("Logging out")
            if not self.logged_in:  # Double-check within the lock to avoid redundant logout attempts
                return False

            url = GRADESCOPE_ROOT + "/logout"
            ref_url = GRADESCOPE_ROOT + "/account"
            try:
                self.last_res = res = self.session.get(url, headers={"Referer": ref_url}, timeout=self.request_timeout)
                if res.ok:
                    self.logged_in = False
                    return True
            except (Timeout, RequestException):
                # If logout fails or times out, we still want to set logged_in to False locally
                # so that we can try logging in again fresh later.
                self.logged_in = False
                return False
            return False

    def download_scores(self, class_id: str, assignment_id: str, filetype: str = "csv") -> bytes:
        """
        Download scores for an assignment with timeout support.
        
        This method overrides the parent class to add request timeout,
        preventing indefinite hangs on slow or unresponsive requests.
        
        Parameters:
            class_id: Gradescope course ID
            assignment_id: Assignment ID
            filetype: File type (default: csv)
            
        Returns:
            bytes: CSV content or False on failure
            
        Raises:
            TimeoutError: If request times out
        """
        if not self.logged_in:
            # print("You must be logged in to download grades!")
            return False
        
        url = f"https://www.gradescope.com/courses/{class_id}/assignments/{assignment_id}/scores.{filetype}"
        
        try:
            self.last_res = res = self.session.get(url, timeout=self.request_timeout)
            if not res or not res.ok:
                # print(f"Failed to get a response from gradescope! Got: {res}")
                return False
            return res.content
        except Timeout:
            print(f"Request timed out after {self.request_timeout}s for assignment {assignment_id}")
            raise TimeoutError(f"Download timed out after {self.request_timeout}s")
        except RequestException as e:
            print(f"Request error for assignment {assignment_id}: {e}")
            raise
