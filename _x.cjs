const fs=require("fs");
const rep=(f,a,b)=>{let s=fs.readFileSync(f,"utf8");if(!s.includes(a))throw new Error(f+": "+a.slice(0,60));fs.writeFileSync(f,s.replace(a,b));};
rep("android/app/src/main/java/app/pliopad/ui/Home.kt",`layout = homeLayout, editing = customizing, onEdit = { customizing = !customizing },`,
`layout = homeLayout, editing = customizing,
                    // Edit starts from the account's latest layout (another device may have changed it).
                    onEdit = {
                        if (customizing) customizing = false
                        else scope.launch {
                            runCatching { app.api.me() }.onSuccess { homeLayout = HomePrefs.fromAccount(ctx, app.api, it.user.prefs) }
                            customizing = true
                        }
                    },`);
rep("desktop/windows/Pliopad.Windows/HomeView.cs",`        else custom = Flat(H(6, I("\uE70F", 13), T("Edit", 13, "PMuted")), () => { _editing = true; Build(); }, "Edit Home", 8);`,
`        else custom = Flat(H(6, I("\uE70F", 13), T("Edit", 13, "PMuted")), async () => { await R.RefreshMe(); _editing = true; Build(); }, "Edit Home", 8);`);
rep("desktop/windows/Pliopad.Core/Repo.cs",`    public async Task SaveHomeLayout(HomeLayout layout)
    {
        if (User == null) return;
        var prefs = User.Prefs?.DeepClone() as JsonObject ?? [];
        prefs["home"] = layout.ToJson();
        User = User with { Prefs = prefs };
        Store.Set("user", JsonSerializer.Serialize(User, Blocks.Json));
        try { await Api.SavePrefs(new JsonObject { ["home"] = layout.ToJson() }); } catch { /* offline: this PC keeps it; the account keeps its last layout */ }
    }`,`    // Layout saves go out one at a time, in order; reading the account waits for them, so it never brings back an older layout.
    private readonly SemaphoreSlim _prefsLock = new(1, 1);

    public async Task SaveHomeLayout(HomeLayout layout)
    {
        if (User == null) return;
        var prefs = User.Prefs?.DeepClone() as JsonObject ?? [];
        prefs["home"] = layout.ToJson();
        User = User with { Prefs = prefs };
        Store.Set("user", JsonSerializer.Serialize(User, Blocks.Json));
        var body = new JsonObject { ["home"] = layout.ToJson() };
        await _prefsLock.WaitAsync();
        try { await Api.SavePrefs(body); } catch { /* offline: this PC keeps it; the account keeps its last layout */ }
        finally { _prefsLock.Release(); }
    }`);
rep("desktop/windows/Pliopad.Core/Repo.cs",`    public async Task RefreshMe()
    {
        try { ApplyMe(await Api.Me()); }`,`    public async Task RefreshMe()
    {
        await _prefsLock.WaitAsync();
        _prefsLock.Release();
        try { ApplyMe(await Api.Me()); }`);
console.log("ok");
