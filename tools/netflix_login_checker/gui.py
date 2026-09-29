from __future__ import annotations

import sys
import shutil
from pathlib import Path
from urllib.parse import quote, unquote, urlparse

try:
    from PySide6.QtCore import QThread, Signal
    from PySide6.QtGui import QGuiApplication
    from PySide6.QtWidgets import (
        QApplication,
        QCheckBox,
        QComboBox,
        QFormLayout,
        QFrame,
        QGroupBox,
        QHBoxLayout,
        QLabel,
        QLineEdit,
        QMainWindow,
        QMessageBox,
        QPushButton,
        QScrollArea,
        QSpinBox,
        QTextEdit,
        QVBoxLayout,
        QWidget,
    )
except ImportError as exc:  # pragma: no cover - depends on local environment
    PYSIDE_IMPORT_ERROR: ImportError | None = exc
else:
    PYSIDE_IMPORT_ERROR = None

from .core import DEFAULT_PROFILES_DIR, DEFAULT_SESSION_URL, login_netflix, resolve_profile_dir
from .backend_api import BackendApiClient, MasterEmailAccount
from .post_login_workflow import WorkflowResult, run_post_login_workflow


class MasterEmailLoader(QThread):
    loaded = Signal(object)
    failed = Signal(str)

    def __init__(self, *, api_url: str, admin_key: str) -> None:
        super().__init__()
        self.api_url = api_url
        self.admin_key = admin_key

    def run(self) -> None:
        try:
            client = BackendApiClient(base_url=self.api_url, admin_key=self.admin_key)
            self.loaded.emit(client.fetch_master_emails(service="netflix"))
        except Exception as exc:  # pragma: no cover - GUI fallback
            self.failed.emit(str(exc))


class ProfileWorker(QThread):
    log = Signal(str)
    status = Signal(str)
    profile_result = Signal(int, object)
    failed = Signal(str)
    finished_ok = Signal()

    def __init__(
        self,
        *,
        email: str,
        password: str,
        pin: str | None,
        count: int,
        headless: bool,
        slow_mo_ms: int,
        proxy_server: str | None,
        clear_session_before_start: bool,
        allow_manual_login: bool,
        api_url: str | None,
        admin_key: str | None,
        master_email_id: str | None,
    ) -> None:
        super().__init__()
        self.email = email
        self.password = password
        self.pin = pin
        self.count = count
        self.headless = headless
        self.slow_mo_ms = slow_mo_ms
        self.proxy_server = proxy_server
        self.clear_session_before_start = clear_session_before_start
        self.allow_manual_login = allow_manual_login
        self.api_url = api_url
        self.admin_key = admin_key
        self.master_email_id = master_email_id

    def run(self) -> None:
        debug = lambda message: self.log.emit(message)
        backend_client = None
        master_email_id = self.master_email_id
        if self.api_url and self.admin_key:
            backend_client = BackendApiClient(base_url=self.api_url, admin_key=self.admin_key)

        try:
            if backend_client and not master_email_id:
                self.log.emit(f"backend_resolve_master_email email={self.email}")
                master_email_id = backend_client.find_master_email_id(email=self.email, service="netflix")
                if master_email_id:
                    self.log.emit(f"backend_master_email_resolved id={master_email_id}")
                else:
                    self.log.emit("backend_master_email_not_found profiles_will_not_be_saved")

            if self.clear_session_before_start:
                removed = clear_profile_session(self.email)
                self.log.emit(f"clear_session_before_start removed={removed}")

            self.log.emit("login_start")
            login_result = login_netflix(
                self.email,
                self.password,
                headless=self.headless,
                timeout_ms=30000,
                slow_mo_ms=self.slow_mo_ms,
                proxy_server=self.proxy_server,
                clear_cache=self.clear_session_before_start,
                persistent_profile=True,
                profiles_dir=DEFAULT_PROFILES_DIR,
                debug=debug,
                allow_manual_login=self.allow_manual_login,
                manual_login_timeout_ms=300000,
            )
            self.log.emit(f"login_result success={login_result.success} reason={login_result.reason}")
            if not login_result.success:
                self.failed.emit(f"Login ไม่สำเร็จ: {login_result.reason}")
                return

            for index in range(1, self.count + 1):
                self.status.emit(f"กำลังสร้างโปรไฟล์ {index}/{self.count}")
                result = run_post_login_workflow(
                    email=self.email,
                    account_password=self.password,
                    account_pin=self.pin,
                    profiles_dir=DEFAULT_PROFILES_DIR,
                    session_url=DEFAULT_SESSION_URL,
                    headless=self.headless,
                    timeout_ms=30000,
                    slow_mo_ms=self.slow_mo_ms,
                    proxy_server=self.proxy_server,
                    debug=debug,
                )
                self.profile_result.emit(index, result)
                if result.success and backend_client and result.profile_name:
                    if not master_email_id:
                        self.log.emit(f"backend_profile_save_skipped index={index} reason=master_email_not_found")
                        continue
                    saved = backend_client.save_profiles(
                        master_email_id=master_email_id,
                        profiles=[
                            {
                                "profileName": result.profile_name,
                                "pin": result.profile_pin,
                                "status": "available",
                                "note": "Created by NetflixProfileCreator",
                            }
                        ],
                    )
                    saved_id = saved[0].get("id") if saved else "-"
                    self.log.emit(f"backend_profile_saved index={index} id={saved_id}")
                if not result.success:
                    self.log.emit(f"profile_{index}_failed reason={result.reason}")
                    break

            self.finished_ok.emit()
        except Exception as exc:  # pragma: no cover - GUI fallback
            self.failed.emit(f"{type(exc).__name__}: {exc}")


class NetflixProfileCreatorWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.worker: ProfileWorker | None = None
        self.loader: MasterEmailLoader | None = None
        self.master_accounts: list[MasterEmailAccount] = []
        self.setWindowTitle("Netflix Profile Creator")
        self.resize(780, 720)

        self.api_url_input = QLineEdit("https://apifastmovie.sysbright.dev/api")
        self.admin_key_input = QLineEdit()
        self.admin_key_input.setEchoMode(QLineEdit.Password)
        self.master_email_input = QComboBox()
        self.master_email_input.addItem("ใช้ข้อมูลที่กรอกเอง", None)
        self.master_email_input.currentIndexChanged.connect(self._selected_master_email_changed)
        self.load_master_button = QPushButton("โหลด Email แม่")
        self.load_master_button.clicked.connect(self.load_master_emails)

        self.email_input = QLineEdit()
        self.password_input = QLineEdit()
        self.password_input.setEchoMode(QLineEdit.Password)
        self.pin_input = QLineEdit()
        self.pin_input.setMaxLength(12)
        self.use_proxy_input = QCheckBox("ใช้ Proxy")
        self.proxy_protocol_input = QComboBox()
        self.proxy_protocol_input.addItems(["SOCKS5", "HTTP", "HTTPS", "SOCKS4"])
        self.proxy_host_input = QLineEdit()
        self.proxy_host_input.setPlaceholderText("IP หรือ Host เช่น 164.90.185.232")
        self.proxy_host_input.editingFinished.connect(self._parse_proxy_text_from_host)
        self.proxy_port_input = QSpinBox()
        self.proxy_port_input.setRange(1, 65535)
        self.proxy_port_input.setValue(1080)
        self.proxy_user_input = QLineEdit()
        self.proxy_user_input.setPlaceholderText("optional")
        self.proxy_password_input = QLineEdit()
        self.proxy_password_input.setPlaceholderText("optional")
        self.proxy_password_input.setEchoMode(QLineEdit.Password)
        self.count_input = QSpinBox()
        self.count_input.setRange(1, 20)
        self.count_input.setValue(1)
        self.headless_input = QCheckBox("Headless")
        self.clear_session_before_start_input = QCheckBox("ล้าง Cookies/Session ก่อนเริ่ม")
        self.manual_login_input = QCheckBox("รอ Login มือถ้าติด")
        self.manual_login_input.setChecked(True)
        self.slow_mo_input = QSpinBox()
        self.slow_mo_input.setRange(0, 1000)
        self.slow_mo_input.setSingleStep(50)
        self.slow_mo_input.setValue(100)
        self.status_label = QLabel("พร้อมใช้งาน")
        self.start_button = QPushButton("เริ่มสร้างโปรไฟล์")
        self.start_button.clicked.connect(self.start)
        self.clear_cache_button = QPushButton("ล้าง Cache")
        self.clear_cache_button.clicked.connect(self.clear_browser_cache)
        self.clear_session_button = QPushButton("ล้าง Cookies/Session")
        self.clear_session_button.clicked.connect(self.clear_browser_session)

        self.cards_layout = QVBoxLayout()
        self.cards_layout.addStretch(1)
        cards_container = QWidget()
        cards_container.setLayout(self.cards_layout)
        self.cards_scroll = QScrollArea()
        self.cards_scroll.setWidgetResizable(True)
        self.cards_scroll.setWidget(cards_container)

        self.log_output = QTextEdit()
        self.log_output.setReadOnly(True)
        self.log_output.setMinimumHeight(120)

        self._build_layout()

    def _build_layout(self) -> None:
        central = QWidget()
        root = QVBoxLayout(central)

        api_box = QGroupBox("Backend API")
        api_form = QFormLayout(api_box)
        api_form.addRow("API URL", self.api_url_input)
        api_form.addRow("Admin Key", self.admin_key_input)
        master_row = QWidget()
        master_layout = QHBoxLayout(master_row)
        master_layout.setContentsMargins(0, 0, 0, 0)
        master_layout.addWidget(self.master_email_input, stretch=1)
        master_layout.addWidget(self.load_master_button)
        api_form.addRow("Master Email", master_row)
        root.addWidget(api_box)

        form_box = QGroupBox("ข้อมูลบัญชี")
        form = QFormLayout(form_box)
        form.addRow("Email แม่", self.email_input)
        form.addRow("Password", self.password_input)
        form.addRow("PIN บัญชี", self.pin_input)
        proxy_row = QWidget()
        proxy_layout = QHBoxLayout(proxy_row)
        proxy_layout.setContentsMargins(0, 0, 0, 0)
        proxy_layout.addWidget(self.use_proxy_input)
        proxy_layout.addWidget(self.proxy_protocol_input)
        proxy_layout.addWidget(self.proxy_host_input, stretch=1)
        proxy_layout.addWidget(self.proxy_port_input)
        form.addRow("Proxy", proxy_row)
        form.addRow("Proxy Username", self.proxy_user_input)
        form.addRow("Proxy Password", self.proxy_password_input)
        form.addRow("จำนวนโปรไฟล์", self.count_input)

        options = QWidget()
        options_layout = QHBoxLayout(options)
        options_layout.setContentsMargins(0, 0, 0, 0)
        options_layout.addWidget(self.headless_input)
        options_layout.addWidget(self.clear_session_before_start_input)
        options_layout.addWidget(self.manual_login_input)
        options_layout.addWidget(QLabel("Slow motion ms"))
        options_layout.addWidget(self.slow_mo_input)
        options_layout.addStretch(1)
        form.addRow("Options", options)
        root.addWidget(form_box)

        actions = QWidget()
        actions_layout = QHBoxLayout(actions)
        actions_layout.setContentsMargins(0, 0, 0, 0)
        actions_layout.addWidget(self.start_button)
        actions_layout.addWidget(self.clear_cache_button)
        actions_layout.addWidget(self.clear_session_button)
        actions_layout.addWidget(self.status_label)
        actions_layout.addStretch(1)
        root.addWidget(actions)

        results_box = QGroupBox("โปรไฟล์ที่สร้าง")
        results_layout = QVBoxLayout(results_box)
        results_layout.addWidget(self.cards_scroll)
        root.addWidget(results_box, stretch=1)

        log_box = QGroupBox("Log")
        log_layout = QVBoxLayout(log_box)
        log_layout.addWidget(self.log_output)
        root.addWidget(log_box)

        self.setCentralWidget(central)

    def load_master_emails(self) -> None:
        if self.loader and self.loader.isRunning():
            return

        api_url = self.api_url_input.text().strip()
        admin_key = self.admin_key_input.text().strip()
        if not api_url or not admin_key:
            QMessageBox.critical(self, "ข้อมูลไม่ครบ", "กรุณาใส่ API URL และ Admin Key")
            return

        self.load_master_button.setEnabled(False)
        self._log("backend_load_master_emails")
        self.loader = MasterEmailLoader(api_url=api_url, admin_key=admin_key)
        self.loader.loaded.connect(self._master_emails_loaded)
        self.loader.failed.connect(self._master_emails_failed)
        self.loader.start()

    def _master_emails_loaded(self, accounts: list[MasterEmailAccount]) -> None:
        self.master_accounts = accounts
        self.master_email_input.blockSignals(True)
        self.master_email_input.clear()
        self.master_email_input.addItem("ใช้ข้อมูลที่กรอกเอง", None)
        for account in accounts:
            label = f"{account.email} · {account.package_name or account.service} · {account.profile_count} profiles"
            if not account.password:
                label += " · ใส่ password เอง"
            self.master_email_input.addItem(label, account)
        self.master_email_input.blockSignals(False)
        self.load_master_button.setEnabled(True)
        self._log(f"backend_master_emails_loaded count={len(accounts)}")

    def _master_emails_failed(self, message: str) -> None:
        self.load_master_button.setEnabled(True)
        self._log(f"backend_load_failed {message}")
        QMessageBox.critical(self, "โหลด Backend ไม่สำเร็จ", message)

    def _selected_master_email_changed(self) -> None:
        account = self.master_email_input.currentData()
        if not isinstance(account, MasterEmailAccount):
            return
        self.email_input.setText(account.email)
        if account.password:
            self.password_input.setText(account.password)

    def clear_browser_cache(self) -> None:
        removed = clear_playwright_cache_dirs()
        self._log(f"clear_cache removed={removed}")
        self.status_label.setText(f"ล้าง cache แล้ว {removed} รายการ")

    def clear_browser_session(self) -> None:
        email = self._current_email()
        if not email:
            QMessageBox.critical(self, "ข้อมูลไม่ครบ", "กรุณาเลือก/ใส่ Email ก่อนล้าง session")
            return

        answer = QMessageBox.question(
            self,
            "ยืนยันการล้าง session",
            f"จะล้าง cookies/session ของ {email}\nต้อง login ใหม่หลังจากนี้ ต้องการต่อไหม?",
        )
        if answer != QMessageBox.StandardButton.Yes:
            return

        removed = clear_profile_session(email)
        profile_dir = resolve_profile_dir(profile_name=None, identifier=email, profiles_dir=DEFAULT_PROFILES_DIR)
        if removed:
            self._log(f"clear_session profile={profile_dir}")
            self.status_label.setText("ล้าง cookies/session แล้ว")
        else:
            self._log(f"clear_session profile_not_found={profile_dir}")
            self.status_label.setText("ไม่พบ session ของ email นี้")

    def start(self) -> None:
        if self.worker and self.worker.isRunning():
            return

        selected_account = self.master_email_input.currentData()
        if isinstance(selected_account, MasterEmailAccount):
            email = selected_account.email
            password = selected_account.password
            master_email_id = selected_account.id
        else:
            email = self.email_input.text().strip()
            password = self.password_input.text().rstrip("\r\n")
            master_email_id = None
        pin = self.pin_input.text().strip() or None
        proxy_server = self._build_proxy_server()
        count = self.count_input.value()

        if not email or not password:
            QMessageBox.critical(self, "ข้อมูลไม่ครบ", "กรุณาใส่ Email และ Password")
            return
        if proxy_server == "":
            QMessageBox.critical(self, "Proxy ไม่ถูกต้อง", "ถ้าใช้ proxy ต้องใส่ IP/Host และ Port ให้ครบ")
            return

        self._clear_cards()
        self._log("เริ่มทำงาน")
        self.status_label.setText("กำลังทำงาน...")
        self.start_button.setEnabled(False)

        self.worker = ProfileWorker(
            email=email,
            password=password,
            pin=pin,
            count=count,
            headless=self.headless_input.isChecked(),
            slow_mo_ms=self.slow_mo_input.value(),
            proxy_server=proxy_server,
            clear_session_before_start=self.clear_session_before_start_input.isChecked(),
            allow_manual_login=self.manual_login_input.isChecked(),
            api_url=self.api_url_input.text().strip() or None,
            admin_key=self.admin_key_input.text().strip() or None,
            master_email_id=master_email_id,
        )
        self.worker.log.connect(self._log)
        self.worker.status.connect(self._set_status)
        self.worker.profile_result.connect(self._add_profile_card)
        self.worker.failed.connect(self._failed)
        self.worker.finished_ok.connect(self._finished)
        self.worker.start()

    def _current_email(self) -> str:
        selected_account = self.master_email_input.currentData()
        if isinstance(selected_account, MasterEmailAccount):
            return selected_account.email
        return self.email_input.text().strip()

    def _set_status(self, message: str) -> None:
        self.status_label.setText(message)
        self._log(message)

    def _failed(self, message: str) -> None:
        self.status_label.setText("หยุดทำงาน")
        self._log(message)
        self.start_button.setEnabled(True)
        QMessageBox.critical(self, "เกิดข้อผิดพลาด", message)

    def _finished(self) -> None:
        self.status_label.setText("เสร็จแล้ว")
        self._log("done")
        self.start_button.setEnabled(True)

    def _add_profile_card(self, index: int, result: WorkflowResult) -> None:
        card = QFrame()
        card.setFrameShape(QFrame.StyledPanel)
        layout = QVBoxLayout(card)

        title = QLabel(f"โปรไฟล์ #{index} - {'สำเร็จ' if result.success else 'ไม่สำเร็จ'}")
        title.setStyleSheet("font-weight: 600;")
        layout.addWidget(title)

        fields = [
            ("Reason", result.reason),
            ("Profile Name", result.profile_name or "-"),
            ("Profile PIN", result.profile_pin or "-"),
            ("URL", result.url),
        ]
        for label, value in fields:
            row = QHBoxLayout()
            name = QLabel(label)
            name.setFixedWidth(100)
            row.addWidget(name)
            row.addWidget(QLabel(str(value)), stretch=1)
            layout.addLayout(row)

        copy_button = QPushButton("Copy")
        copy_button.clicked.connect(lambda _checked=False, r=result: self._copy_result(r))
        layout.addWidget(copy_button)

        self.cards_layout.insertWidget(self.cards_layout.count() - 1, card)

    def _copy_result(self, result: WorkflowResult) -> None:
        text = (
            f"profile_name={result.profile_name or ''}\n"
            f"profile_pin={result.profile_pin or ''}\n"
            f"success={result.success}\n"
            f"reason={result.reason}"
        )
        QGuiApplication.clipboard().setText(text)
        self.status_label.setText("copy แล้ว")

    def _build_proxy_server(self) -> str | None:
        if not self.use_proxy_input.isChecked():
            return None

        self._parse_proxy_text_from_host()
        host = self.proxy_host_input.text().strip()
        if not host:
            return None

        protocol = self.proxy_protocol_input.currentText().strip().lower()
        port = self.proxy_port_input.value()
        username = self.proxy_user_input.text().strip()
        password = self.proxy_password_input.text()
        if not protocol or not port:
            return ""

        credentials = ""
        if username:
            credentials = quote(username, safe="")
            if password:
                credentials += f":{quote(password, safe='')}"
            credentials += "@"
        return f"{protocol}://{credentials}{host}:{port}"

    def _parse_proxy_text_from_host(self) -> None:
        text = self.proxy_host_input.text().strip()
        if "://" not in text:
            return

        parsed = urlparse(text)
        if not parsed.scheme or not parsed.hostname:
            return

        protocol = parsed.scheme.upper()
        protocol_index = self.proxy_protocol_input.findText(protocol)
        if protocol_index >= 0:
            self.proxy_protocol_input.setCurrentIndex(protocol_index)

        self.proxy_host_input.blockSignals(True)
        self.proxy_host_input.setText(parsed.hostname)
        self.proxy_host_input.blockSignals(False)

        if parsed.port:
            self.proxy_port_input.setValue(parsed.port)
        if parsed.username:
            self.proxy_user_input.setText(unquote(parsed.username))
        if parsed.password:
            self.proxy_password_input.setText(unquote(parsed.password))
        self.use_proxy_input.setChecked(True)

    def _clear_cards(self) -> None:
        while self.cards_layout.count() > 1:
            item = self.cards_layout.takeAt(0)
            widget = item.widget()
            if widget:
                widget.deleteLater()

    def _log(self, message: str) -> None:
        self.log_output.append(message)


def clear_playwright_cache_dirs(profiles_dir: str | Path = DEFAULT_PROFILES_DIR) -> int:
    cache_names = {
        "Cache",
        "Code Cache",
        "GPUCache",
        "DawnCache",
        "ShaderCache",
        "GrShaderCache",
        "GraphiteDawnCache",
        "blob_storage",
        "CacheStorage",
    }
    root = Path(profiles_dir)
    if not root.exists():
        return 0

    removed = 0
    for path in sorted(root.rglob("*"), key=lambda item: len(item.parts), reverse=True):
        if path.is_dir() and path.name in cache_names:
            shutil.rmtree(path, ignore_errors=True)
            removed += 1
    return removed


def clear_profile_session(email: str, profiles_dir: str | Path = DEFAULT_PROFILES_DIR) -> int:
    profile_dir = resolve_profile_dir(profile_name=None, identifier=email, profiles_dir=profiles_dir)
    if not profile_dir.exists():
        return 0
    shutil.rmtree(profile_dir, ignore_errors=True)
    return 1


def main() -> None:
    if PYSIDE_IMPORT_ERROR:
        raise SystemExit(
            "PySide6 is not installed. Run: pip install -r requirements-netflix-login.txt"
        )
    app = QApplication(sys.argv)
    window = NetflixProfileCreatorWindow()
    window.show()
    raise SystemExit(app.exec())


if __name__ == "__main__":
    main()
