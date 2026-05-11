cmake_minimum_required(VERSION 3.13)
project(video-compare CXX)

# =============================================================================
# 1. 核心需求：生成 compile_commands.json (给 LSP 使用)
# =============================================================================
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# =============================================================================
# 2. 基础编译选项 (对应 Makefile 的 CXXFLAGS)
# =============================================================================
set(CMAKE_CXX_STANDARD 14)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# 定义宏
add_definitions(-D__STDC_CONSTANT_MACROS)

# 添加编译警告和优化选项
add_compile_options(
    -g3 -Ofast 
    -Wall -Wextra -Wno-deprecated -Wno-deprecated-declarations
    -Wdisabled-optimization -Wctor-dtor-privacy
    -Woverloaded-virtual -Wno-unused -Wno-missing-field-initializers
)

# =============================================================================
# 3. 平台与路径检测逻辑
# =============================================================================

# WebAssembly (Emscripten) 构建
if(EMSCRIPTEN)
    message(STATUS "Platform: Emscripten (WebAssembly) detected")
    set(WASM_BUILD ON)

    # Wasm特定编译选项 (纯计算库,无需SDL2)
    add_compile_options(-O3)

    # Wasm构建不包含FFmpeg
    add_definitions(-DWASM_BUILD)
    
# MinGW (Windows)
elseif(MINGW)
    # --- 对应 Makefile: ifeq (...MINGW64_NT-10.0...) ---
    message(STATUS "Platform: MinGW detected")
    
    # 硬编码的版本号和路径 (与原 Makefile 保持一致)
    set(FFMPEG_VERSION "8.0.1-full_build-shared")
    set(SDL2_VERSION "2.32.8")
    set(SDL2_TTF_VERSION "2.24.0")

    # 假设这些目录就在项目源码的同级或子级目录下
    set(FFMPEG_PATH "${CMAKE_SOURCE_DIR}/ffmpeg-${FFMPEG_VERSION}")
    set(SDL2_PATH "${CMAKE_SOURCE_DIR}/SDL2-devel-${SDL2_VERSION}-mingw/SDL2-${SDL2_VERSION}/x86_64-w64-mingw32")
    set(SDL2_TTF_PATH "${CMAKE_SOURCE_DIR}/SDL2_ttf-devel-${SDL2_TTF_VERSION}-mingw/SDL2_ttf-${SDL2_TTF_VERSION}/x86_64-w64-mingw32")

    include_directories(
        ${FFMPEG_PATH}/include
        ${SDL2_PATH}/include
        ${SDL2_PATH}/include/SDL2
        ${SDL2_TTF_PATH}/include
    )

    link_directories(
        ${FFMPEG_PATH}/lib
        ${SDL2_PATH}/lib
        ${SDL2_TTF_PATH}/lib
    )

else()
    # --- 对应 Makefile: else (Linux/macOS) ---
    message(STATUS "Platform: Linux/macOS detected")
    
    # 查找 Pthread (对应 Makefile 的 -pthread)
    find_package(Threads REQUIRED)
    
    # --- 对应 Makefile: Homebrew / MacPorts / usr 路径检测 ---
    if(EXISTS "/opt/homebrew")
        include_directories("/opt/homebrew/include")
        link_directories("/opt/homebrew/lib")
        # 设置安装路径前缀，等同于 make install 的 BINDIR
        if(CMAKE_INSTALL_PREFIX_INITIALIZED_TO_DEFAULT)
            set(CMAKE_INSTALL_PREFIX "/opt/homebrew" CACHE PATH "..." FORCE)
        endif()
    elseif(EXISTS "/opt/local")
        include_directories("/opt/local/include")
        link_directories("/opt/local/lib")
        if(CMAKE_INSTALL_PREFIX_INITIALIZED_TO_DEFAULT)
            set(CMAKE_INSTALL_PREFIX "/opt/local" CACHE PATH "..." FORCE)
        endif()
    else()
        include_directories("/usr/local/include")
        link_directories("/usr/local/lib")
    endif()

    if(EXISTS "/usr/include/ffmpeg")
        include_directories("/usr/include/ffmpeg")
    endif()
endif()

# =============================================================================
# 4. 库链接逻辑 (Pkg-config 选项)
# =============================================================================

# Wasm构建: 纯计算库,无需FFmpeg或SDL2
if(WASM_BUILD)
    message(STATUS "Wasm build: pure computation library (no external dependencies)")
    set(TARGET_LIBS)
else()
    set(TARGET_LIBS avformat avcodec avfilter avutil swscale swresample SDL2_ttf SDL2)
    
    option(USE_PKG_CONFIG "Use pkg-config to find libraries" OFF)

    if(USE_PKG_CONFIG)
        find_package(PkgConfig REQUIRED)
        pkg_check_modules(DEPS REQUIRED libavformat libavcodec libavfilter libavutil libswscale libswresample sdl2 SDL2_ttf)
        # 覆盖上面的 TARGET_LIBS，使用 pkg-config 找到的具体库
        set(TARGET_LIBS ${DEPS_LIBRARIES})
        include_directories(${DEPS_INCLUDE_DIRS})
    endif()
endif()

# =============================================================================
# 5. 构建目标
# =============================================================================

# Wasm构建: 纯计算库,无GUI依赖
if(WASM_BUILD)
    message(STATUS "Wasm build: using pure computation library (no GUI)")
    set(SOURCES
        wasm_comparer.cpp
        wasm_main.cpp
    )
    message(STATUS "Wasm build sources: ${SOURCES}")
else()
    # 自动查找所有 .cpp 文件 (对应 src = $(wildcard *.cpp))
    file(GLOB SOURCES "*.cpp")
endif()

add_executable(video-compare ${SOURCES})

# 链接库
target_link_libraries(video-compare PRIVATE ${TARGET_LIBS})

# Wasm特定链接选项
if(WASM_BUILD)
    # 输出.html和.js文件
    set_target_properties(video-compare PROPERTIES
        SUFFIX ".js"
    )

    # 添加Emscripten链接标志 (使用Emscripten Bindings)
    # 注意: 每个-s选项必须作为单个参数传递,格式为-sOPTION=value
    target_link_options(video-compare PRIVATE
        -sALLOW_MEMORY_GROWTH=1
        -sMAX_WEBGL_VERSION=2
        -sEXPORTED_FUNCTIONS=['_malloc','_free']
        -sEXPORTED_RUNTIME_METHODS=['ccall','cwrap','FS']
        -sENVIRONMENT=['web','node']
        -sEXPORT_NAME="VideoCompareModule"
        -lembind
    )
endif()

if(NOT MINGW AND NOT WASM_BUILD)
    target_link_libraries(video-compare PRIVATE Threads::Threads)
endif()

# =============================================================================
# 6. 安装与测试 (make install / make test)
# =============================================================================
install(TARGETS video-compare DESTINATION bin)

enable_testing()
add_test(NAME run_test COMMAND video-compare -w 800x screenshot_1.jpg screenshot_2.jpg)
